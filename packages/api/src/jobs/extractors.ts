import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import mammoth from "mammoth";
import type { Document } from "@edgebric/types";
import { decryptFileToTemp, decryptFile } from "../lib/crypto.js";

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
  // Decrypt in memory — text files don't need a temp file
  const content = decryptFile(filePath);
  return { markdown: content.toString("utf-8"), headingPageMap: new Map() };
}

export async function extractDocument(
  filePath: string,
  type: Document["type"],
): Promise<ExtractionResult> {
  // PDF and DOCX extractors need a real file path, so decrypt to temp if encrypted.
  // Text files are handled in-memory by extractText.
  if (type === "pdf" || type === "docx") {
    const { tempPath, needsCleanup } = decryptFileToTemp(filePath);
    try {
      return type === "pdf" ? await extractPDF(tempPath) : await extractDOCX(tempPath);
    } finally {
      if (needsCleanup) {
        await fs.unlink(tempPath).catch(() => {});
      }
    }
  }
  return extractText(filePath);
}
