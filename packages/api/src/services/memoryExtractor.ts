/**
 * Memory Extractor — rule-based heuristics that detect user preferences,
 * facts, and corrections from chat messages. Runs post-response (no latency
 * impact on the user). No LLM calls — purely regex-based.
 */
import { saveMemory, isMemoryEnabled } from "./memoryStore.js";
import type { MemoryCategory } from "./memoryStore.js";
import { logger } from "../lib/logger.js";

/** A detected memory candidate from a user message. */
export interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
}

// ─── Pattern Definitions ────────────────────────────────────────────────────

/**
 * Preference patterns — "I prefer", "always use", "never", "don't ever"
 */
const PREFERENCE_PATTERNS: RegExp[] = [
  /\bi (?:always |usually )?prefer\s+(.{5,80})/i,
  /\balways (?:use|give me|show me|format|send)\s+(.{5,80})/i,
  /\bnever (?:use|give me|show me|format|send)\s+(.{5,80})/i,
  /\bdon'?t ever\s+(.{5,80})/i,
  /\bi (?:like|want|need) (?:my |the )?(?:responses?|answers?|output) (?:to be |in )?(.{5,80})/i,
  /\bplease (?:always|never)\s+(.{5,80})/i,
];

/**
 * Fact patterns — "I am a", "I work in", "my role is", "my name is"
 */
const FACT_PATTERNS: RegExp[] = [
  /\bi (?:am|work) (?:a |an |as a |as an |in |at |for )\s*(.{3,80})/i,
  /\bmy (?:role|title|position|job|department|team|company|organization) is\s+(.{3,80})/i,
  /\bmy name is\s+(.{2,50})/i,
  /\bi'?m (?:a |an |the )\s*(.{3,80})/i,
  /\bi (?:manage|lead|run|own|oversee)\s+(.{5,80})/i,
];

/**
 * Correction patterns — "no, I meant", "that's wrong", "actually"
 * These capture the corrected information as an instruction.
 */
const CORRECTION_PATTERNS: RegExp[] = [
  /\bno,?\s+i (?:meant|mean)\s+(.{5,100})/i,
  /\bthat'?s (?:wrong|incorrect|not right)[.,]?\s*(.{5,100})/i,
  /\bactually,?\s+(?:i |it |the |my )(.{5,100})/i,
  /\bi (?:said|asked for|wanted)\s+(.{5,100})/i,
];

// ─── Extraction Logic ───────────────────────────────────────────────────────

/**
 * Extract potential memory entries from a user message using heuristics.
 * Returns an array of candidate memories (may be empty).
 *
 * This is intentionally conservative — better to miss some memories
 * than to save garbage.
 */
export function extractMemories(userMessage: string): ExtractedMemory[] {
  const results: ExtractedMemory[] = [];

  // Skip very short messages (unlikely to contain useful memories)
  if (userMessage.length < 15) return results;

  // Skip questions (the user is asking, not stating)
  if (userMessage.trim().endsWith("?")) return results;

  // Check preference patterns
  for (const pattern of PREFERENCE_PATTERNS) {
    const match = pattern.exec(userMessage);
    if (match?.[1]) {
      results.push({
        content: cleanExtract(`User ${userMessage.slice(0, 120).trim()}`),
        category: "preference",
      });
      break; // One preference per message max
    }
  }

  // Check fact patterns
  for (const pattern of FACT_PATTERNS) {
    const match = pattern.exec(userMessage);
    if (match?.[1]) {
      results.push({
        content: cleanExtract(`User: ${userMessage.slice(0, 120).trim()}`),
        category: "fact",
      });
      break; // One fact per message max
    }
  }

  // Check correction patterns → save as instruction
  for (const pattern of CORRECTION_PATTERNS) {
    const match = pattern.exec(userMessage);
    if (match?.[1]) {
      results.push({
        content: cleanExtract(`Correction: ${userMessage.slice(0, 120).trim()}`),
        category: "instruction",
      });
      break;
    }
  }

  return results;
}

/**
 * Clean up extracted text — trim, remove trailing punctuation artifacts.
 */
function cleanExtract(text: string): string {
  return text
    .replace(/[.!,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Process a user message for automatic memory extraction.
 * Runs asynchronously after the LLM response — no latency impact.
 *
 * @param userMessage - The user's chat message
 * @param orgId - Organization ID (undefined for solo mode)
 * @param userId - User email
 */
export async function processMessageForMemories(
  userMessage: string,
  orgId: string | undefined,
  userId: string,
): Promise<void> {
  if (!isMemoryEnabled()) return;

  const candidates = extractMemories(userMessage);
  if (candidates.length === 0) return;

  for (const candidate of candidates) {
    try {
      await saveMemory({
        content: candidate.content,
        category: candidate.category,
        confidence: 0.7,
        source: "auto",
        orgId,
        userId,
      });
      logger.debug({ content: candidate.content.slice(0, 50), category: candidate.category }, "Auto-saved memory");
    } catch (err) {
      logger.warn({ err }, "Failed to auto-save memory");
    }
  }
}
