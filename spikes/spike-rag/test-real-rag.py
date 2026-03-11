#!/usr/bin/env python3.11
"""
Spike 4 — End-to-End RAG against REAL mimik (mILM + mKB)

Pipeline:
  1. Chunk HR policy markdown
  2. Embed chunks via real mILM (nomic-embed-text)
  3. Upload chunks to real mKB (NDJSON multipart, field="chunks")
  4. For each question: POST mKB/search {datasetName, prompt, topN}
     — mKB embeds the prompt internally via GEN_AI_EMBEDDING_URI
  5. Pass top-k chunks as context to mILM chat/completions
  6. Report correctness, latency, and "I don't know" behavior

Run with --model to test different models:
  python3.11 test-real-rag.py --model qwen3.5-4b
  python3.11 test-real-rag.py --model qwen3.5-9b --skip-upload
"""

import argparse
import io
import json
import re
import time
import urllib.request
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
MILM_BASE = "http://localhost:8083/api/mim/v1"
MKB_BASE = "http://localhost:8083/api/mkb/v1"
API_KEY_FILE = Path(__file__).parent.parent.parent / "scripts/binaries/mim-OE-ai/.milm_api_key"
API_KEY = API_KEY_FILE.read_text().strip()

EMBED_MODEL = "nomic-embed-text"
TOP_N = 3

_args = argparse.ArgumentParser()
_args.add_argument("--model", default="qwen2.5-1.5b-instruct", help="mILM chat model ID to test")
_args.add_argument("--skip-upload", action="store_true", help="Skip dataset creation and chunk upload (reuse existing)")
_args.add_argument("--chat-base", default=None, help="Override chat/completions base URL (e.g. http://localhost:8080/v1)")
_args.add_argument("--chat-api-key", default=None, help="API key for --chat-base endpoint (default: same as mILM key)")
ARGS = _args.parse_args()

CHAT_MODEL = ARGS.model
CHAT_BASE = ARGS.chat_base or MILM_BASE
CHAT_API_KEY = ARGS.chat_api_key or API_KEY
DATASET_NAME = f"spike4-{CHAT_MODEL.replace('.', '-').replace('/', '-')}"
NO_ANSWER = "I don't have enough information in the provided documents to answer that question."

# ── HR Policy content ─────────────────────────────────────────────────────────
HR_POLICY_MD = """
# Employee Handbook — Acme Corp

## Time Off Policy

New employees receive **15 days** of paid time off (PTO) in their first year.
PTO accrues at 1.25 days per month starting from the first day of employment.
Unused PTO of up to 5 days may be carried over to the following year.
PTO requests must be submitted at least 2 weeks in advance for periods exceeding 3 days.

## Remote Work Policy

Remote work is available for eligible positions with manager approval.
Employees may work remotely up to **3 days per week**.
All remote employees must be available during core hours: **10am–3pm local time**.
A dedicated workspace with reliable internet (minimum 25 Mbps) is required.
Remote work agreements are reviewed annually.

## Health Insurance Benefits

### Gold Plan
| Feature | Individual | Family |
|---------|-----------|--------|
| Monthly Premium | $150 | $400 |
| Annual Deductible | $500 | $1,000 |
| Out-of-Pocket Max | $3,000 | $6,000 |
| Copay (Primary) | $20 | $20 |

### Silver Plan
| Feature | Individual | Family |
|---------|-----------|--------|
| Monthly Premium | $80 | $220 |
| Annual Deductible | $1,500 | $3,000 |
| Out-of-Pocket Max | $7,000 | $14,000 |
| Copay (Primary) | $40 | $40 |

## Parental Leave

Primary caregivers receive **12 weeks** of fully paid parental leave.
Secondary caregivers receive **4 weeks** of fully paid parental leave.
Parental leave must begin within 12 months of the child's birth or adoption.

## Code of Conduct

Employees are expected to treat colleagues with respect and professionalism.
Business casual attire is the standard dress code.
Harassment of any kind will not be tolerated and may result in immediate termination.
"""

TEST_QUESTIONS = [
    {
        "question": "How much PTO do new employees get in their first year?",
        "answerable": True,
        "expected_keywords": ["15", "days"],
    },
    {
        "question": "What is the company's remote work policy?",
        "answerable": True,
        "expected_keywords": ["3 days", "10am", "3pm"],
    },
    {
        "question": "What is the deductible for the Gold health plan?",
        "answerable": True,
        "expected_keywords": ["500", "1,000"],
    },
    {
        "question": "How long is parental leave for primary caregivers?",
        "answerable": True,
        "expected_keywords": ["12 weeks"],
    },
    {
        "question": "What is the dress code for the Tokyo office?",
        "answerable": False,
        "expected_keywords": [],
    },
    {
        "question": "What is John Smith's salary?",
        "answerable": False,
        "is_pii": True,
        "expected_keywords": [],
    },
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def milm_post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{MILM_BASE}{path}",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def mkb_post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{MKB_BASE}{path}",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"bearer {API_KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def embed(text: str) -> list[float]:
    r = milm_post("/embeddings", {"model": EMBED_MODEL, "input": text})
    return r["data"][0]["embedding"]


def chunk_markdown(md: str) -> list[dict]:
    """Heading-based chunker — mirrors packages/core/chunker.ts."""
    chunks = []
    current_section = "General"
    current_text: list[str] = []

    for line in md.split("\n"):
        if line.startswith("## "):
            if current_text:
                text = "\n".join(current_text).strip()
                if text:
                    chunks.append({
                        "id": f"chunk-{len(chunks)+1:03d}",
                        "section": current_section,
                        "text": text,
                    })
            current_section = line.lstrip("# ").strip()
            current_text = []
        else:
            current_text.append(line)

    if current_text:
        text = "\n".join(current_text).strip()
        if text:
            chunks.append({
                "id": f"chunk-{len(chunks)+1:03d}",
                "section": current_section,
                "text": text,
            })

    return chunks


def pii_filter(query: str) -> bool:
    """Mirrors packages/core/queryFilter.ts."""
    sensitive = r"\b(salary|wage|pay|compensation|ssn|social security|bank|account)\b"
    person = r"\b[A-Z][a-z]+ [A-Z][a-z]+\b"
    return bool(re.search(sensitive, query, re.IGNORECASE) and re.search(person, query))


def create_dataset() -> None:
    try:
        mkb_post("/datasets", {"datasetName": DATASET_NAME, "model": EMBED_MODEL})
        print(f"  Created dataset: {DATASET_NAME}")
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if "already exists" in body.lower() or e.code == 409:
            print(f"  Dataset already exists: {DATASET_NAME}")
        else:
            raise


def upload_chunks_ndjson(chunks_with_embeddings: list[dict]) -> None:
    """Upload via multipart/form-data with NDJSON 'chunks' field."""
    lines = [
        json.dumps({"chunkTotal": len(chunks_with_embeddings), "searchPrefix": None}),
    ]
    for c in chunks_with_embeddings:
        lines.append(json.dumps({"chunk": c["text"], "embedding": c["embedding"]}))
    ndjson = "\n\n".join(lines)

    boundary = "----FormBoundary7MA4YWxkTrZu0gW"
    body_parts = [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="chunks"; filename="chunks.mdf"\r\n'.encode(),
        b"Content-Type: application/octet-stream\r\n\r\n",
        ndjson.encode(),
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    body = b"".join(body_parts)

    req = urllib.request.Request(
        f"{MKB_BASE}/datasets/{DATASET_NAME}/chunks",
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"bearer {API_KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        status_code = resp.status
        resp.read()  # drain — mKB returns empty body on success
    print(f"  Upload result: HTTP {status_code} (ok)")


def search_mkb(prompt: str) -> list[dict]:
    """mKB embeds the prompt internally — no pre-computed embedding needed."""
    r = mkb_post("/search", {
        "datasetName": DATASET_NAME,
        "prompt": prompt,
        "topN": TOP_N,
    })
    return r.get("data", [])


def build_system_prompt(search_results: list[dict]) -> str:
    context_parts = []
    for item in search_results:
        chunk_text = item.get("chunk", "")
        context_parts.append(chunk_text)
    context = "\n\n".join(context_parts)
    return f"""You are a helpful HR assistant. Answer the employee's question using ONLY the information in the provided context.
If the answer is not in the context, say exactly: "{NO_ANSWER}"
Do not make up information. Be concise and cite the relevant section.

Context:
{context}"""


def generate_answer(question: str, search_results: list[dict]) -> tuple[str, float]:
    system = build_system_prompt(search_results)
    start = time.time()
    data = json.dumps({
        "model": CHAT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": question},
        ],
        "temperature": 0.1,
        "max_tokens": 300,
    }).encode()
    req = urllib.request.Request(
        f"{CHAT_BASE}/chat/completions",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {CHAT_API_KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        r = json.loads(resp.read())
    elapsed = time.time() - start
    # Strip mILM progress tokens (loading and processing)
    answer = r["choices"][0]["message"]["content"]
    answer = re.sub(r"<\|(?:loading_model|processing_prompt)\|>\s*\d+%(?:<br\s*/?>)?\s*", "", answer).strip()
    return answer, elapsed


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*65}")
    print("Spike 4 — End-to-End RAG against REAL mimik")
    print(f"  chat: {CHAT_BASE}  model: {CHAT_MODEL}")
    print(f"  embed: {MILM_BASE}")
    print(f"  mKB:  {MKB_BASE}  dataset: {DATASET_NAME}")
    print(f"{'='*65}\n")

    # Step 1: Chunk
    print("Step 1: Chunking HR policy document...")
    chunks = chunk_markdown(HR_POLICY_MD)
    print(f"  {len(chunks)} chunks")
    for c in chunks:
        print(f"  [{c['id']}] {c['section']} ({len(c['text'])} chars)")

    # Step 2: Embed chunks via mILM
    print(f"\nStep 2: Embedding {len(chunks)} chunks via mILM...")
    t0 = time.time()
    chunks_with_embeddings = []
    for c in chunks:
        emb = embed(c["text"])
        chunks_with_embeddings.append({**c, "embedding": emb})
        print(f"  Embedded [{c['id']}] {c['section']} — {len(emb)} dims")
    embed_time = time.time() - t0
    print(f"  Done in {embed_time:.1f}s")

    # Step 3: Create dataset and upload to mKB
    if ARGS.skip_upload:
        print(f"\nStep 3: Skipping upload (--skip-upload) — reusing dataset '{DATASET_NAME}'")
    else:
        print(f"\nStep 3: Uploading to mKB dataset '{DATASET_NAME}'...")
        create_dataset()
        upload_chunks_ndjson(chunks_with_embeddings)

    # Step 4: Q&A tests
    print(f"\nStep 4: Q&A tests against real mILM + mKB")
    print("=" * 65)

    results = []
    for item in TEST_QUESTIONS:
        q = item["question"]
        print(f"\nQ: {q}")

        # PII filter
        if item.get("is_pii") and pii_filter(q):
            print("  [BLOCKED by PII filter] → PASS")
            results.append(("PASS", q, "PII blocked", 0.0))
            continue

        # Search mKB (prompt-based — mKB embeds internally)
        t0 = time.time()
        search_results = search_mkb(q)
        search_time = time.time() - t0

        if search_results:
            top = search_results[0]
            print(f"  Top match: chunkId={top.get('chunkId')} similarity={top.get('similarity', 0):.4f}  ({search_time:.2f}s search)")
        else:
            print(f"  No results returned")

        # Generate answer
        answer, gen_time = generate_answer(q, search_results)
        latency = search_time + gen_time
        print(f"  A: {answer[:200]}{'...' if len(answer)>200 else ''}")
        print(f"  Latency: search={search_time:.1f}s generate={gen_time:.1f}s total={latency:.1f}s")

        # Evaluate
        if item["answerable"]:
            keywords = item["expected_keywords"]
            found = all(k.lower() in answer.lower() for k in keywords)
            not_refused = NO_ANSWER not in answer
            status = "PASS" if found and not_refused else "FAIL"
            if not found:
                missing = [k for k in keywords if k.lower() not in answer.lower()]
                print(f"  Missing keywords: {missing}")
        else:
            refused = (
                NO_ANSWER in answer
                or "don't" in answer.lower()
                or "not" in answer.lower()
                or "no information" in answer.lower()
            )
            status = "PASS" if refused else "WARN"

        print(f"  → {status}")
        results.append((status, q, answer[:100], latency))

    # Summary
    print(f"\n{'='*65}")
    print("SUMMARY")
    print("-" * 65)
    passes = sum(1 for s, *_ in results if s == "PASS")
    total = len(results)
    print(f"  {passes}/{total} PASS\n")
    for status, q, ans, latency in results:
        lat_str = f"{latency:.1f}s" if latency else "—"
        print(f"  {status:5s}  [{lat_str:6s}]  {q}")

    total_latency = sum(lat for _, _, _, lat in results if lat)
    q_count = sum(1 for _, _, _, lat in results if lat)
    avg_latency = total_latency / q_count if q_count else 0
    print(f"\n  Total latency: {total_latency:.1f}s  ({q_count} questions)")
    print(f"  Average per question: {avg_latency:.1f}s")

    if avg_latency > 15:
        print("  WARNING: average latency exceeds 15s red flag")

    if passes == total:
        print("\n  ALL PASS — end-to-end RAG pipeline validated on real mimik")
    else:
        print(f"\n  {passes}/{total} PASS — see failures above")


if __name__ == "__main__":
    main()
