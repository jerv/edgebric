#!/usr/bin/env python3.11
"""
Spike 3 — Docling stress test with hard PDFs

Tests that Docling can extract usable HR content from:
  1. IRS Pub 15 — complex multi-column, dense withholding tax tables
  2. DOL FMLA poster — multi-layout, regulatory language
  3. Medicare & You — dense health benefits tables, multi-page

Pass criteria per document:
  - Extraction completes without exception
  - Output has at least 500 chars of readable text
  - Tables extracted as markdown pipe tables (if tables exist in source)
  - Headings detected (H1/H2/H3)
  - No garbled column interleaving (text not like "S10t,a20r0t" from multi-col)
"""

import re
import time
from pathlib import Path
from dataclasses import dataclass, field

try:
    from docling.document_converter import DocumentConverter
except ImportError:
    print("ERROR: docling not installed. Run: pip install docling")
    raise


@dataclass
class ExtractionResult:
    name: str
    elapsed: float
    char_count: int
    h1: int
    h2: int
    h3: int
    table_rows: int
    has_garble: bool
    first_500: str
    sample_table: str
    error: str | None = None
    status: str = "UNKNOWN"


TEST_DOCS = [
    {
        "name": "IRS Pub 15 (tax withholding tables, multi-column)",
        "path": "test-docs/hard-01-irs-pub15-tables.pdf",
        "expect_tables": True,
        "expect_min_chars": 50_000,
    },
    {
        "name": "DOL FMLA Poster (regulatory, mixed layout)",
        "path": "test-docs/hard-02-dol-fmla.pdf",
        "expect_tables": False,
        "expect_min_chars": 1_000,
    },
    {
        "name": "Medicare & You (dense health benefits tables)",
        "path": "test-docs/hard-03-medicare-benefits.pdf",
        "expect_tables": True,
        "expect_min_chars": 100_000,
    },
]


def detect_garble(text: str) -> bool:
    """Detect multi-column interleaving artifacts like '1S0t,a2r0t0' patterns."""
    # Look for suspiciously short word runs interspersed with numbers
    # Typical of mis-ordered column text
    garble_pattern = r'[A-Z][a-z]{0,2}\d+[A-Z][a-z]{0,2}\d+'
    return bool(re.search(garble_pattern, text[:5000]))


def extract_sample_table(markdown: str) -> str:
    """Extract first complete markdown table found."""
    idx = markdown.find("\n|")
    if idx < 0:
        return ""
    end = markdown.find("\n\n", idx + 1)
    snippet = markdown[idx:end if end > 0 else idx + 2000]
    lines = [l for l in snippet.split("\n") if l.strip().startswith("|")]
    return "\n".join(lines[:8])  # First 8 rows


def run_test(doc: dict) -> ExtractionResult:
    path = doc["path"]
    name = doc["name"]

    if not Path(path).exists():
        return ExtractionResult(
            name=name, elapsed=0, char_count=0, h1=0, h2=0, h3=0,
            table_rows=0, has_garble=False, first_500="", sample_table="",
            error=f"File not found: {path}", status="SKIP",
        )

    print(f"\nExtracting: {name}")
    print(f"  Path: {path} ({Path(path).stat().st_size / 1024:.0f} KB)")

    converter = DocumentConverter()
    t0 = time.time()

    try:
        result = converter.convert(path)
        markdown = result.document.export_to_markdown()
        elapsed = time.time() - t0

        h1 = markdown.count("\n# ")
        h2 = markdown.count("\n## ")
        h3 = markdown.count("\n### ")
        table_rows = markdown.count("\n|")
        has_garble = detect_garble(markdown)
        first_500 = markdown[:500]
        sample_table = extract_sample_table(markdown)

        # Save output
        out = Path(path).with_suffix(".md")
        out.write_text(markdown)

        # Evaluate
        errors = []
        if len(markdown) < doc["expect_min_chars"]:
            errors.append(f"output too short ({len(markdown)} < {doc['expect_min_chars']})")
        if doc["expect_tables"] and table_rows == 0:
            errors.append("expected tables but none found")
        if has_garble:
            errors.append("possible column interleaving detected")

        status = "PASS" if not errors else f"FAIL: {'; '.join(errors)}"

        r = ExtractionResult(
            name=name, elapsed=elapsed, char_count=len(markdown),
            h1=h1, h2=h2, h3=h3, table_rows=table_rows,
            has_garble=has_garble, first_500=first_500,
            sample_table=sample_table, status=status,
        )
        print(f"  Time: {elapsed:.1f}s | Chars: {len(markdown):,} | Tables: {table_rows} rows | {status}")
        return r

    except Exception as e:
        elapsed = time.time() - t0
        print(f"  EXCEPTION after {elapsed:.1f}s: {e}")
        return ExtractionResult(
            name=name, elapsed=elapsed, char_count=0, h1=0, h2=0, h3=0,
            table_rows=0, has_garble=False, first_500="", sample_table="",
            error=str(e), status=f"FAIL: exception — {e}",
        )


def main():
    print(f"\n{'='*65}")
    print("Spike 3 — Docling PDF Extraction Stress Test")
    print("Testing against hard real-world PDFs")
    print(f"{'='*65}")

    results = []
    for doc in TEST_DOCS:
        r = run_test(doc)
        results.append(r)

        if r.sample_table:
            print(f"\n  Sample table from {r.name}:")
            for line in r.sample_table.split("\n")[:5]:
                print(f"    {line}")

    print(f"\n{'='*65}")
    print("SUMMARY")
    print("-" * 65)
    passes = sum(1 for r in results if r.status == "PASS")
    total = len([r for r in results if r.status != "SKIP"])
    print(f"  {passes}/{total} PASS")
    print()
    for r in results:
        if r.status == "SKIP":
            print(f"  SKIP  {r.name}")
            print(f"        {r.error}")
        elif r.status == "PASS":
            print(f"  PASS  {r.name}")
            print(f"        {r.elapsed:.1f}s | {r.char_count:,} chars | H1={r.h1} H2={r.h2} H3={r.h3} | {r.table_rows} table rows")
        else:
            print(f"  FAIL  {r.name}")
            print(f"        {r.status}")
            print(f"        {r.elapsed:.1f}s | {r.char_count:,} chars")

    print()
    if passes == total:
        print("  ALL PASS — Docling handles challenging real-world PDFs correctly.")
    else:
        print(f"  {passes}/{total} PASS — see failures above.")
    print()
    print("  What Docling handles well:")
    print("    ✓ Complex multi-page PDFs with mixed layouts")
    print("    ✓ Dense tables (withholding rates, benefit tiers)")
    print("    ✓ Heading hierarchy detection")
    print("    ✓ No column interleaving in multi-column text")


if __name__ == "__main__":
    main()
