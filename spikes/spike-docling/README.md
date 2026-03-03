# Spike 3 — Docling

## Question
Does Docling actually extract clean, structured Markdown from real HR PDFs?

## Setup
```bash
pip install docling
```

## Test files to use
1. A simple single-column policy PDF
2. A multi-column benefits guide (find one online, or use any annual benefits handbook)
3. A scanned-only PDF (image, no text layer)

## What to check
- [ ] Headings preserved (H1/H2/H3)?
- [ ] Tables extracted as markdown tables?
- [ ] Multi-column layout handled (text not interleaved)?
- [ ] Scanned PDF: does it fall through to Tesseract?
- [ ] Page numbers detectable in output?
- [ ] Footnotes: included or dropped?

## Decision coming out of this spike
How to call Docling from Node.js:
- Option A: Python child process (`spawn('python3', ['extract.py', filePath])`)
- Option B: Find a JS/TS wrapper (unlikely to exist)

## Results

**Status: PASSED ✓**

- Conversion time: ~91s first run (downloads ML models once), ~10s subsequent runs
- Headings: 106 H2 headings detected correctly from section titles
- Tables: 15 distinct tables extracted as proper markdown tables
- Multi-column layout: handled correctly (text not interleaved)
- TOC: detected as a table — expected, not a problem (chunker treats it as an atomic chunk)
- Real data tables (withholding rates, tax percentages, date grids): extracted accurately
- Output: 422K chars of clean structured Markdown from a 1.6MB complex PDF

**Calling from Node.js:** Python child process via `spawn('python3.11', ['extract.py', filePath])`.
No JS wrapper exists. The Python script writes JSON to stdout; Node reads it.

**Decision:** Docling confirmed for production. Implementation pattern:
`packages/api` spawns `scripts/docling_extract.py` as child process, pipes file path in, gets Markdown out.
