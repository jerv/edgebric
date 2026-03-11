# Spike 3 — Docling

## Status: COMPLETE — 3/3 PASS (basic) + 3/3 PASS (hard PDF stress test)

## Question
Does Docling actually extract clean, structured Markdown from real HR PDFs, including
challenging multi-column layouts, dense regulatory documents, and large health benefits guides?

## Setup
```bash
pip install docling
```

## Results

### Basic test (sample-handbook.pdf)

- Conversion time: ~91s first run (downloads ML models once), ~10s subsequent runs
- Headings: 106 H2 headings detected correctly from section titles
- Tables: 15 distinct tables extracted as proper markdown tables
- Multi-column layout: handled correctly (text not interleaved)
- Output: 422K chars of clean structured Markdown from a 1.6MB complex PDF

### Hard PDF stress test (test-hard-pdfs.py)

| Document | Size | Time | Chars | Tables | Status |
|----------|------|------|-------|--------|--------|
| IRS Pub 15 (multi-column withholding tables) | 1.6 MB | 31.8s | 422,020 | 201 rows | PASS |
| DOL FMLA Poster (regulatory, mixed layout) | 63 KB | 1.6s | 5,234 | 0 (correct) | PASS |
| Medicare & You (dense health benefits tables) | 3.9 MB | 32.1s | 320,818 | 88 rows | PASS |

All three passed all criteria:
- No column interleaving artifacts
- Correct table detection (no false positives on non-table docs)
- Headings detected throughout (H2 predominant for these docs)

**Calling from Node.js:** Python child process via `spawn('python3.11', ['extract.py', filePath])`.
No JS wrapper exists. The Python script writes JSON to stdout; Node reads it.

**Decision:** Docling confirmed for production. Implementation pattern:
`packages/api` spawns `scripts/docling_extract.py` as child process, pipes file path in, gets Markdown out.
