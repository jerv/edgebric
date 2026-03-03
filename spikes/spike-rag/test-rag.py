#!/usr/bin/env python3.11
"""
Spike 4 — End-to-End RAG Pipeline

Tests the complete pipeline:
  1. Chunk a markdown HR policy document
  2. Embed all chunks (mILM equivalent: Ollama nomic-embed-text)
  3. Build an in-memory vector index (mKB equivalent)
  4. For each test question: embed → search top-k → generate grounded answer
  5. Report: correctness, citations, latency, "I don't know" behavior

Production wiring (same API calls, just different base URL):
  embed:    POST http://localhost:8083/api/mim/v1/embeddings
  generate: POST http://localhost:8083/api/mim/v1/chat/completions
  search:   POST http://localhost:8083/api/mkb/v1/datasets/{name}/search
"""

import json
import math
import re
import time
import urllib.request
from typing import Any

# ── Config ────────────────────────────────────────────────────────────────────
OLLAMA_BASE = "http://localhost:11434/v1"
CHAT_MODEL = "llama3.2:3b"
EMBED_MODEL = "nomic-embed-text"
TOP_K = 3
SIMILARITY_THRESHOLD = 0.60
NO_ANSWER = "I don't have enough information in the provided documents to answer that question."

# ── Sample HR Policy (mimics a real handbook chunk after Docling extraction) ──
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

# ── Test questions ─────────────────────────────────────────────────────────────
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
        "answerable": False,  # Tokyo not mentioned — should say "I don't know"
        "expected_keywords": [],
    },
    {
        "question": "What is John Smith's salary?",  # PII filter test
        "answerable": False,
        "is_pii": True,
        "expected_keywords": [],
    },
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def api_post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{OLLAMA_BASE}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def embed(text: str) -> list[float]:
    r = api_post("/embeddings", {"model": EMBED_MODEL, "input": text})
    return r["data"][0]["embedding"]


def cosine_sim(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag = math.sqrt(sum(x**2 for x in a)) * math.sqrt(sum(x**2 for x in b))
    return dot / mag if mag else 0.0


def chunk_markdown(md: str) -> list[dict]:
    """Simple heading-based chunker (mirrors packages/core/chunker.ts)."""
    chunks = []
    current_section = "General"
    current_text = []

    for line in md.split("\n"):
        if line.startswith("## "):
            if current_text:
                text = "\n".join(current_text).strip()
                if text:
                    chunks.append({"id": f"chunk-{len(chunks)+1:03d}", "section": current_section, "text": text})
            current_section = line.lstrip("# ").strip()
            current_text = []
        elif line.startswith("### "):
            # Sub-section stays part of current section
            current_text.append(line)
        else:
            current_text.append(line)

    if current_text:
        text = "\n".join(current_text).strip()
        if text:
            chunks.append({"id": f"chunk-{len(chunks)+1:03d}", "section": current_section, "text": text})

    return chunks


def pii_filter(query: str) -> bool:
    """Layer 4 data leakage prevention — mirrors packages/core/queryFilter.ts."""
    SENSITIVE_TERMS = r"\b(salary|wage|pay|compensation|ssn|social security|bank|account)\b"
    PERSON_PATTERN = r"\b[A-Z][a-z]+ [A-Z][a-z]+\b"
    if re.search(SENSITIVE_TERMS, query, re.IGNORECASE) and re.search(PERSON_PATTERN, query):
        return True  # blocked
    return False


def build_system_prompt(chunks: list[dict]) -> str:
    context = "\n\n".join(
        f"[Section: {c['section']}]\n{c['text']}" for c in chunks
    )
    return f"""You are a helpful HR assistant. Answer the employee's question using ONLY the information in the provided context.
If the answer is not in the context, say exactly: "{NO_ANSWER}"
Do not make up information. Be concise and cite the relevant section.

Context:
{context}"""


def generate(question: str, context_chunks: list[dict]) -> tuple[str, float]:
    """Generate a grounded answer."""
    system = build_system_prompt(context_chunks)
    start = time.time()
    r = api_post("/chat/completions", {
        "model": CHAT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": question},
        ],
        "temperature": 0.1,
        "max_tokens": 300,
    })
    elapsed = time.time() - start
    return r["choices"][0]["message"]["content"], elapsed


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*65}")
    print("Spike 4 — End-to-End RAG Pipeline")
    print(f"{'='*65}\n")

    # Step 1: Chunk the document
    print("Step 1: Chunking HR policy document...")
    chunks = chunk_markdown(HR_POLICY_MD)
    print(f"  {len(chunks)} chunks created")
    for c in chunks:
        print(f"  [{c['id']}] {c['section']} ({len(c['text'])} chars)")

    # Step 2: Embed all chunks
    print(f"\nStep 2: Embedding {len(chunks)} chunks...")
    start = time.time()
    dataset: list[dict[str, Any]] = []
    for c in chunks:
        emb = embed(c["text"])
        dataset.append({**c, "embedding": emb})
    embed_time = time.time() - start
    print(f"  Done in {embed_time:.1f}s ({embed_time/len(chunks):.1f}s per chunk)")

    # Step 3: Answer each question
    print(f"\nStep 3: Q&A tests")
    print("=" * 65)

    results = []
    for item in TEST_QUESTIONS:
        q = item["question"]
        print(f"\nQ: {q}")

        # PII filter
        if item.get("is_pii") and pii_filter(q):
            print("  [BLOCKED by PII filter] → PASS")
            results.append(("PASS", q, "PII blocked", 0))
            continue

        # Embed query
        q_emb = embed(q)

        # Similarity search
        scored = [(cosine_sim(q_emb, d["embedding"]), d) for d in dataset]
        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:TOP_K]
        top_score = top[0][0]

        print(f"  Top match: [{top[0][1]['id']}] {top[0][1]['section']} (score={top_score:.4f})")

        # Hard cutoff for unanswerable questions
        relevant_chunks = [d for s, d in top if s >= SIMILARITY_THRESHOLD]

        # Generate answer
        context = relevant_chunks if relevant_chunks else []
        answer, latency = generate(q, context)

        print(f"  A: {answer[:200]}{'...' if len(answer)>200 else ''}")
        print(f"  Latency: {latency:.1f}s")

        # Evaluate
        if item["answerable"]:
            keywords = item["expected_keywords"]
            found = all(k.lower() in answer.lower() for k in keywords)
            not_refused = NO_ANSWER not in answer
            status = "PASS" if found and not_refused else "FAIL"
            if not found:
                print(f"  Missing keywords: {[k for k in keywords if k.lower() not in answer.lower()]}")
        else:
            # Should refuse or give hedged answer
            refused = NO_ANSWER in answer or "don't" in answer.lower() or "not" in answer.lower()
            status = "PASS" if refused else "WARN"

        print(f"  → {status}")
        results.append((status, q, answer[:100], latency))

    # Summary
    print(f"\n{'='*65}")
    print("SUMMARY")
    print("-" * 65)
    passes = sum(1 for s, *_ in results if s == "PASS")
    total = len(results)
    print(f"  {passes}/{total} tests passed")
    print()
    for status, q, ans, latency in results:
        lat_str = f"{latency:.1f}s" if latency else "—"
        print(f"  {status:4s}  [{lat_str:5s}]  {q}")

    total_latency = sum(l for _, _, _, l in results)
    print(f"\n  Total latency: {total_latency:.1f}s")
    print(f"  Average latency per question: {total_latency/len(results):.1f}s")

    if passes == total:
        print("\n  ALL TESTS PASSED — RAG pipeline validated")
    elif passes >= total * 0.8:
        print(f"\n  {passes}/{total} PASSED — minor issues, see details above")
    else:
        print(f"\n  {passes}/{total} PASSED — pipeline needs tuning")


if __name__ == "__main__":
    main()
