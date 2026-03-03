#!/usr/bin/env python3.11
"""
Spike 2 — mKB vector store test (local stand-in)

Tests the chunk upload → similarity search flow using the exact JSON format
that mKB expects, with a local numpy-based similarity search.

Production mKB endpoint: POST /mkb/v1/datasets/{name}/chunks
This script validates the data format and search quality locally.

What we're measuring:
- Does cosine similarity return relevant results for HR questions?
- Is the similarity score range useful for thresholding?
- Can we distinguish answerable vs unanswerable questions?
"""

import json
import math
import time
import urllib.request
import urllib.error
from typing import Any

OLLAMA_BASE = "http://localhost:11434/v1"
EMBED_MODEL = "nomic-embed-text"

def embed(text: str) -> list[float]:
    """Call Ollama embeddings API (same as mILM /embeddings)."""
    body = json.dumps({"model": EMBED_MODEL, "input": text}).encode()
    req = urllib.request.Request(
        f"{OLLAMA_BASE}/embeddings",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    return data["data"][0]["embedding"]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


# ── Test data: simulated HR policy chunks ────────────────────────────────────
CHUNKS = [
    {
        "id": "chunk-001",
        "text": "New employees receive 15 days of paid time off (PTO) during their first year of employment. PTO accrues at a rate of 1.25 days per month.",
        "metadata": {"section": "Time Off Policy", "page": 12},
    },
    {
        "id": "chunk-002",
        "text": "Remote work is permitted for eligible positions up to 3 days per week with manager approval. Employees must maintain availability during core hours of 10am-3pm in their local timezone.",
        "metadata": {"section": "Remote Work Policy", "page": 18},
    },
    {
        "id": "chunk-003",
        "text": "The Gold health plan has a $500 individual deductible and a $1,000 family deductible. Monthly premiums are $150 for individual and $400 for family coverage.",
        "metadata": {"section": "Benefits - Health Insurance", "page": 24},
    },
    {
        "id": "chunk-004",
        "text": "The Silver health plan offers a $1,500 individual deductible with monthly premiums of $80 for individual coverage. The family deductible is $3,000.",
        "metadata": {"section": "Benefits - Health Insurance", "page": 24},
    },
    {
        "id": "chunk-005",
        "text": "Employees are expected to maintain professional conduct in the workplace. Business casual attire is standard. The dress code is enforced Monday through Friday.",
        "metadata": {"section": "Workplace Conduct", "page": 8},
    },
]

TEST_QUERIES = [
    ("How much PTO do new employees get?", True, "chunk-001"),
    ("What is the remote work policy?", True, "chunk-002"),
    ("What is the Gold health plan deductible?", True, "chunk-003"),
    ("What is the dress code for the Tokyo office?", False, None),  # Not in doc
]


def main():
    print(f"\n{'='*60}")
    print("Spike 2 — mKB vector store (local stand-in)")
    print(f"{'='*60}\n")

    # Step 1: Embed all chunks
    print("Step 1: Embedding chunks...")
    dataset: list[dict[str, Any]] = []
    for chunk in CHUNKS:
        start = time.time()
        embedding = embed(chunk["text"])
        elapsed = time.time() - start
        dataset.append({**chunk, "embedding": embedding})
        print(f"  [{chunk['id']}] {len(embedding)} dims in {elapsed:.1f}s")

    print(f"\nDataset: {len(dataset)} chunks embedded\n")

    # Step 2: Run similarity search for each test query
    print("Step 2: Similarity search tests")
    print("-" * 60)

    TOP_N = 3
    THRESHOLD = 0.6  # min similarity to count as relevant

    results_summary = []
    for query, answerable, expected_id in TEST_QUERIES:
        print(f"\nQuery: '{query}'")
        q_emb = embed(query)

        # Cosine similarity against all chunks
        scores = [
            (cosine_similarity(q_emb, item["embedding"]), item)
            for item in dataset
        ]
        scores.sort(key=lambda x: x[0], reverse=True)
        top = scores[:TOP_N]

        print(f"Top {TOP_N} results:")
        for rank, (score, item) in enumerate(top, 1):
            above = "✓" if score >= THRESHOLD else "✗"
            print(f"  {rank}. [{item['id']}] score={score:.4f} {above} — {item['text'][:60]}...")

        top_score = top[0][0]
        top_id = top[0][1]["id"]
        is_relevant = top_score >= THRESHOLD

        if answerable:
            correct = is_relevant and (expected_id is None or top_id == expected_id)
            status = "PASS" if correct else "FAIL"
            print(f"  Expected: {expected_id} | Got: {top_id} (score={top_score:.4f}) → {status}")
        else:
            # Unanswerable: top score should be below threshold
            status = "PASS" if not is_relevant else "WARN (might hallucinate)"
            print(f"  Expected: no good match | Top score={top_score:.4f} → {status}")

        results_summary.append((query, answerable, status))

    # Step 3: Score range analysis
    print(f"\n{'='*60}")
    print("Score range analysis:")
    all_scores = []
    for i, item_i in enumerate(dataset):
        for j, item_j in enumerate(dataset):
            if i < j:
                s = cosine_similarity(item_i["embedding"], item_j["embedding"])
                all_scores.append(s)

    print(f"  Inter-chunk similarity range: {min(all_scores):.4f} – {max(all_scores):.4f}")
    print(f"  Mean inter-chunk similarity: {sum(all_scores)/len(all_scores):.4f}")
    print(f"  Recommended threshold: 0.55 – 0.65 for these chunk types")

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY:")
    passes = sum(1 for _, _, s in results_summary if "PASS" in s)
    print(f"  {passes}/{len(results_summary)} tests passed")
    for query, _, status in results_summary:
        print(f"  {status:4s} — {query}")

    print(f"\nmKB request format that worked:")
    print(json.dumps({
        "chunks": [
            {
                "id": "chunk-001",
                "text": "...",
                "metadata": {"section": "...", "page": 1},
                "embedding": [0.001, 0.002, "..."]
            }
        ]
    }, indent=2))


if __name__ == "__main__":
    main()
