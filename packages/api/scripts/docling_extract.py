#!/usr/bin/env python3.11
import sys
import json
from docling.document_converter import DocumentConverter


def main():
    if len(sys.argv) < 2:
        print("Usage: docling_extract.py <file_path>", file=sys.stderr)
        sys.exit(1)
    try:
        result = DocumentConverter().convert(sys.argv[1])
        doc = result.document

        # Walk document items to build heading text → page number map.
        # SectionHeaderItem has provenance (page_no) attached directly.
        heading_pages: dict[str, int] = {}
        for item, _ in doc.iterate_items():
            if type(item).__name__ == "SectionHeaderItem":
                text = getattr(item, "text", "").replace("\xa0", " ").strip()
                prov = getattr(item, "prov", [])
                page = prov[0].page_no if prov else 1
                if text:
                    heading_pages[text] = page

        markdown = doc.export_to_markdown()
        print(json.dumps({"markdown": markdown, "headingPages": heading_pages}), end="")
    except Exception as e:
        print(f"Extraction failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
