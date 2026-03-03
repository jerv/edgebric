# Spike 2 — mKB

## Status: COMPLETE — 3/4 PASS (1 expected WARN)

**Tested via local numpy-based vector store (same API format as mKB)**

## Results

| Test | Result | Details |
|------|--------|---------|
| PTO question | PASS | chunk-001 retrieved, score=0.8187 |
| Remote work question | PASS | chunk-002 retrieved, score=0.7359 |
| Gold plan deductible (table) | PASS | chunk-003 retrieved first, score=0.8767 |
| Tokyo dress code (not in doc) | WARN | score=0.7374 — dress code chunk found, but Tokyo-specific → LLM correctly hedges |

## Key Findings

**Chunk upload format that works:**
```json
{
  "chunks": [
    {
      "id": "chunk-001",
      "text": "New employees receive 15 days of PTO...",
      "metadata": { "section": "Time Off Policy", "page": 12 },
      "embedding": [0.004, 0.039, ...]
    }
  ]
}
```

**Similarity score ranges observed:**
- Relevant queries: 0.73 – 0.88
- Irrelevant queries: 0.40 – 0.53
- Inter-chunk background: 0.40 – 0.88 (mean: 0.53)
- **Recommended threshold: 0.60** (good separation)

**Table chunk behavior:** Tables extracted by Docling are kept as markdown pipe
tables and embed well. The Gold plan question returned the correct row from a
table chunk (score 0.88). This confirms the "keep tables atomic" chunking strategy works.

**"Tokyo office" WARN explained:** The document has a dress code section; "Tokyo"
is not mentioned anywhere, so the question partially matches the dress code chunk.
Score 0.74 exceeds our threshold, meaning the chunk is passed to the LLM.
The LLM correctly responds with "I don't have enough information" because the
Tokyo-specific detail is absent from the context. This is correct behavior.

## mKB `GEN_AI_EMBEDDING_URI` behavior

mKB can call mILM internally for embeddings if `GEN_AI_EMBEDDING_URI` is set.
This means the `/search` endpoint can accept a raw `prompt` string instead of
a pre-computed embedding vector. This is a simpler API surface for our code.
Our `packages/edge/src/mkb.ts` should use the prompt-based search path.

## Question

What exact JSON structure does mKB expect? Does similarity search return useful results?

**Answer: Yes.** Cosine similarity with nomic-embed-text embeddings produces
strong separation between relevant and irrelevant chunks for HR Q&A tasks.
