import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import mammoth from "mammoth";
import type { Document } from "@edgebric/types";

export interface ExtractionResult {
  markdown: string;
  headingPageMap: Map<string, number>; // heading text → page number (PDF only)
}

const DOCLING_SCRIPT = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../../scripts/docling_extract.py",
);

async function extractPDF(filePath: string): Promise<ExtractionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3.11", [DOCLING_SCRIPT, filePath]);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PDF extraction timed out after 3 minutes"));
    }, 3 * 60 * 1000);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
        reject(new Error(`Docling extraction failed (exit ${code}): ${stderr}`));
        return;
      }

      const raw = Buffer.concat(stdoutChunks).toString("utf-8");
      let parsed: { markdown: string; headingPages: Record<string, number> };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        reject(new Error("Docling output was not valid JSON"));
        return;
      }

      const headingPageMap = new Map<string, number>(
        Object.entries(parsed.headingPages),
      );
      resolve({ markdown: parsed.markdown, headingPageMap });
    });
  });
}

async function extractDOCX(filePath: string): Promise<ExtractionResult> {
  const result = await mammoth.extractRawText({ path: filePath });
  return { markdown: result.value, headingPageMap: new Map() };
}

async function extractText(filePath: string): Promise<ExtractionResult> {
  const markdown = await fs.readFile(filePath, "utf-8");
  return { markdown, headingPageMap: new Map() };
}

export async function extractDocument(
  filePath: string,
  type: Document["type"],
): Promise<ExtractionResult> {
  switch (type) {
    case "pdf":
      return extractPDF(filePath);
    case "docx":
      return extractDOCX(filePath);
    default:
      return extractText(filePath);
  }
}
