import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  addFeedback,
  getFeedbackByMessageId,
  updateFeedbackTopic,
} from "../services/feedbackStore.js";
import { getMessages, getConversation } from "../services/conversationStore.js";

const feedbackSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(2000).optional(),
});

export const feedbackRouter: IRouter = Router();
feedbackRouter.use(requireOrg);

// POST /api/feedback — submit a rating for a message
feedbackRouter.post("/", validateBody(feedbackSchema), (req, res) => {
  const { conversationId, messageId, rating, comment } = req.body as z.infer<typeof feedbackSchema>;

  // Verify conversation ownership
  const conv = getConversation(conversationId);
  if (!conv || (conv.userEmail !== req.session.email && !req.session.isAdmin)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Prevent double-rating
  const existing = getFeedbackByMessageId(messageId);
  if (existing) {
    res.status(409).json({ error: "This message has already been rated" });
    return;
  }

  // Build message snapshot: all messages up to and including the rated message
  const allMessages = getMessages(conversationId);
  const ratedIndex = allMessages.findIndex((m) => m.id === messageId);
  if (ratedIndex === -1) {
    res.status(404).json({ error: "Message not found in conversation" });
    return;
  }
  const snapshot = allMessages.slice(0, ratedIndex + 1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const fb = addFeedback({
    conversationId,
    messageId,
    rating,
    messageSnapshot: snapshot,
    comment: rating === "down" ? comment?.trim() || undefined : undefined,
    orgId: req.session.orgId,
  });

  // Fire-and-forget topic extraction
  void extractTopicAsync(fb.id, snapshot);

  res.status(201).json({ id: fb.id, rating: fb.rating });
});

// GET /api/feedback/:messageId — check if a message has been rated
feedbackRouter.get("/:messageId", (req, res) => {
  const fb = getFeedbackByMessageId(req.params["messageId"]!);
  if (!fb) {
    res.json({ rated: false });
    return;
  }
  res.json({ rated: true, rating: fb.rating });
});

/**
 * Extract a short topic label from the conversation snapshot.
 * Simple keyword-based approach: strip stop words, take first 4 content words.
 * Upgradeable to LLM-based extraction by changing this function body.
 */
async function extractTopicAsync(
  feedbackId: string,
  snapshot: Array<{ role: string; content: string }>,
): Promise<void> {
  try {
    const lastUserMsg = [...snapshot].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    const stopWords = new Set([
      "what", "how", "when", "where", "who", "why", "does", "do", "is", "are",
      "can", "could", "would", "should", "will", "the", "a", "an", "my", "our",
      "i", "we", "about", "for", "to", "in", "of", "on", "at", "with",
      "please", "tell", "me", "explain", "describe", "know", "need", "want",
      "get", "have", "has", "had", "been", "being", "if", "or", "and", "but",
      "not", "this", "that", "these", "those", "it", "its", "there", "here",
    ]);

    const words = lastUserMsg.content
      .toLowerCase()
      .replace(/[?!.,;:'"()\[\]{}]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w));

    const topic = words.slice(0, 4).join(" ") || "general";
    updateFeedbackTopic(feedbackId, topic);
  } catch {
    // Non-critical — topic extraction failure should not affect anything
  }
}
