# Spikes

Throwaway experiments that answer specific technical questions. Each spike is self-contained, fully disposable, and should be completed before writing the corresponding production code.

**Rule:** No spike code gets refactored into production. You write down what you learned in the spike's README, then write fresh production code informed by that knowledge.

---

## Spike 1 — Ollama Inference

**Question:** Does Qwen3-4B run on available hardware? What's the actual throughput? Does streaming match OpenAI format?

**Do this first.** If the model is too slow, we need to know before building anything else.

**Status:** PASS

---

## Spike 2 — sqlite-vec

**Question:** Does sqlite-vec handle our vector storage needs? What's the query latency on 50K chunks? How does it integrate with the existing SQLite database?

**Status:** PASS

---

## Spike 3 — Docling

**Question:** Does Docling actually handle complex HR PDFs? Tables, multi-column layouts, scanned pages?

**Status:** PASS

---

## Spike 4 — End-to-End RAG

**Question:** Does the full pipeline (Ollama embeddings → sqlite-vec storage → hybrid search with FTS5 → Ollama generation) produce correct, cited answers from a real policy document?

**This is the most important spike.** Run it before building any UI.

**Status:** PASS
