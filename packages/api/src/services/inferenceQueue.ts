/**
 * Application-layer inference queue.
 *
 * Instead of letting all concurrent requests hit Ollama's opaque FIFO,
 * we own the queue so we can:
 * - Show queue position to users via SSE before token streaming begins
 * - Prioritize interactive queries over background tasks (summarization)
 * - Track queue depth for admin monitoring / system load indicator
 * - Cancel queued requests when clients disconnect
 *
 * The queue is FIFO with two priority lanes:
 *   high   — interactive user queries (solo + group chat)
 *   low    — background work (summarization, re-indexing)
 *
 * Concurrency limit = INFERENCE_CONCURRENCY env var (default 2).
 * When all slots are busy, new requests wait and receive position updates.
 */

import { logger } from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type InferencePriority = "high" | "low";

interface QueueEntry {
  id: string;
  priority: InferencePriority;
  resolve: () => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  /** Called when position changes — allows SSE feedback. */
  onPositionUpdate?: ((position: number) => void) | undefined;
  /** Set to true when the client disconnects — entry will be drained. */
  cancelled: boolean;
}

export interface QueueStats {
  /** Number of inference requests currently running. */
  active: number;
  /** Number of requests waiting in queue. */
  queued: number;
  /** Max concurrent inferences allowed. */
  concurrency: number;
  /** Average wait time in ms (rolling window). */
  avgWaitMs: number;
}

// ─── Queue implementation ───────────────────────────────────────────────────

const MAX_QUEUE_DEPTH = 50;
const CONCURRENCY = Math.max(1, parseInt(process.env.INFERENCE_CONCURRENCY ?? "2", 10));

let activeCount = 0;
const queue: QueueEntry[] = [];

/** Rolling window of recent wait times for avg calculation. */
const recentWaits: number[] = [];
const MAX_WAIT_SAMPLES = 50;

function recordWait(ms: number) {
  recentWaits.push(ms);
  if (recentWaits.length > MAX_WAIT_SAMPLES) recentWaits.shift();
}

function drainNext() {
  // Remove cancelled entries from the front
  while (queue.length > 0 && queue[0]!.cancelled) {
    const entry = queue.shift()!;
    entry.reject(new Error("Cancelled"));
  }

  if (queue.length === 0 || activeCount >= CONCURRENCY) return;

  // High-priority first
  let nextIdx = queue.findIndex((e) => e.priority === "high" && !e.cancelled);
  if (nextIdx === -1) nextIdx = queue.findIndex((e) => !e.cancelled);
  if (nextIdx === -1) return;

  const entry = queue.splice(nextIdx, 1)[0]!;
  activeCount++;
  recordWait(Date.now() - entry.enqueuedAt);
  entry.resolve();

  // Notify remaining entries of their new positions
  broadcastPositions();
}

function broadcastPositions() {
  let highPos = 0;
  let lowPos = 0;
  for (const entry of queue) {
    if (entry.cancelled) continue;
    const pos = entry.priority === "high" ? ++highPos : ++lowPos;
    entry.onPositionUpdate?.(pos);
  }
}

/**
 * Acquire an inference slot. Resolves when it's your turn.
 *
 * @param id - Unique request ID for logging/cancellation.
 * @param priority - "high" for interactive, "low" for background.
 * @param onPositionUpdate - Called with queue position (1-based) as it changes.
 * @param signal - AbortSignal to cancel if client disconnects.
 * @returns A release function — MUST be called when inference is done.
 */
export async function acquireSlot(
  id: string,
  priority: InferencePriority = "high",
  onPositionUpdate?: (position: number) => void,
  signal?: AbortSignal,
): Promise<() => void> {
  // Fast path: slot available
  if (activeCount < CONCURRENCY) {
    activeCount++;
    return releaseSlot;
  }

  // Queue is full — reject
  if (queue.length >= MAX_QUEUE_DEPTH) {
    throw new QueueFullError(queue.length);
  }

  // Wait for a slot
  return new Promise<() => void>((resolve, reject) => {
    const entry: QueueEntry = {
      id,
      priority,
      resolve: () => resolve(releaseSlot),
      reject,
      enqueuedAt: Date.now(),
      onPositionUpdate,
      cancelled: false,
    };
    queue.push(entry);

    // Send initial position
    const position = queue.filter((e) => !e.cancelled).indexOf(entry) + 1;
    onPositionUpdate?.(position);

    // Handle client disconnect
    if (signal) {
      const onAbort = () => {
        entry.cancelled = true;
        entry.reject(new Error("Cancelled"));
        broadcastPositions();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    logger.debug({ id, priority, position, queueDepth: queue.length }, "Request queued for inference");
  });
}

function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1);
  drainNext();
}

/** Get current queue statistics for admin monitoring. */
export function getQueueStats(): QueueStats {
  const avgWaitMs = recentWaits.length > 0
    ? Math.round(recentWaits.reduce((a, b) => a + b, 0) / recentWaits.length)
    : 0;

  return {
    active: activeCount,
    queued: queue.filter((e) => !e.cancelled).length,
    concurrency: CONCURRENCY,
    avgWaitMs,
  };
}

/** Custom error for queue overflow. */
export class QueueFullError extends Error {
  public readonly queueDepth: number;
  constructor(depth: number) {
    super(`Inference queue full (${depth} pending). Please try again shortly.`);
    this.name = "QueueFullError";
    this.queueDepth = depth;
  }
}
