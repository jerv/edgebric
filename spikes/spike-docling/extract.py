#!/usr/bin/env python3.11
"""
Spike 3 — Docling PDF extraction test

Tests Docling against a real complex PDF and reports:
- Whether headings are preserved
- Whether tables are extracted as markdown
- Output quality
"""

import sys
import time
from pathlib import Path

from docling.document_converter import DocumentConverter

def test_pdf(pdf_path: str) -> None:
    print(f"\n{'='*60}")
    print(f"Testing: {pdf_path}")
    print(f"{'='*60}\n")

    converter = DocumentConverter()

    start = time.time()
    print("Converting... (first run downloads models, may take a minute)")
    result = converter.convert(pdf_path)
    elapsed = time.time() - start

    markdown = result.document.export_to_markdown()

    print(f"Conversion time: {elapsed:.1f}s")
    print(f"Output length: {len(markdown)} chars")
    print(f"Pages detected: ~{markdown.count('<!-- page')}")
    print()

    # Count headings
    h1 = markdown.count("\n# ")
    h2 = markdown.count("\n## ")
    h3 = markdown.count("\n### ")
    print(f"Headings found: H1={h1}, H2={h2}, H3={h3}")

    # Count tables
    table_count = markdown.count("\n|")
    print(f"Table rows found: {table_count}")

    # Show first 3000 chars
    print(f"\n--- First 3000 chars of output ---\n")
    print(markdown[:3000])

    # Find and show a table if present
    if "|" in markdown:
        table_start = markdown.find("\n|")
        if table_start > -1:
            table_end = markdown.find("\n\n", table_start + 1)
            print(f"\n--- Sample table ---\n")
            print(markdown[table_start:table_end if table_end > -1 else table_start + 2000])

    # Save full output
    out_path = Path(pdf_path).with_suffix(".md")
    out_path.write_text(markdown)
    print(f"\nFull output saved to: {out_path}")


if __name__ == "__main__":
    pdf = sys.argv[1] if len(sys.argv) > 1 else "test-docs/sample-handbook.pdf"
    test_pdf(pdf)
