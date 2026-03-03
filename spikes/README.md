# Spikes

Throwaway experiments that answer specific technical questions. Each spike is self-contained, fully disposable, and should be completed before writing the corresponding production code.

**Rule:** No spike code gets refactored into production. You write down what you learned in the spike's README, then write fresh production code informed by that knowledge.

---

## Spike 1 — mILM (`spike-milm/`)

**Question:** Does Qwen3-4B run on available hardware? What's the actual throughput? Does streaming match OpenAI format?

**Do this first.** If the model is too slow, we need to know before building anything else.

**Status:** Not started

---

## Spike 2 — mKB (`spike-mkb/`)

**Question:** Exactly what JSON structure does mKB expect? Does similarity search return useful scores?

**Status:** Not started

---

## Spike 3 — Docling (`spike-docling/`)

**Question:** Does Docling actually handle complex HR PDFs? Tables, multi-column layouts, scanned pages?

**Status:** Not started

---

## Spike 4 — End-to-End RAG (`spike-rag/`)

**Question:** Does the full pipeline produce correct, cited answers from a real policy document?

**This is the most important spike.** Run it before building any UI.

**Status:** Not started
