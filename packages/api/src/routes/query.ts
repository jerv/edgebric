import { Router } from "express";
import { answerStream, createSession } from "@edgebric/core/rag";
import { createMILMClient } from "@edgebric/edge";
import { createMKBClient } from "@edgebric/edge";
import { requireDeviceToken } from "../middleware/deviceToken.js";
import { config } from "../config.js";
import type { Session } from "@edgebric/types";

export const queryRouter = Router();

const milm = createMILMClient(config.edge);
const mkb = createMKBClient(config.edge);

// In-memory session store (keyed by sessionId)
// MVP: sessions are lost on server restart — acceptable
const sessions = new Map<string, Session>();

queryRouter.use(requireDeviceToken);

queryRouter.post("/", async (req, res) => {
  const { query, sessionId } = req.body as { query?: string; sessionId?: string };

  if (!query?.trim()) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  // Get or create session
  let session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    session = createSession();
    sessions.set(session.id, session);
  }

  // Set up SSE streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const stream = answerStream(
      query,
      session,
      {
        datasetName: "policy-documents",
        companyName: config.companyName,
        topK: 5,
        similarityThreshold: 0.3,
      },
      {
        embed: (text) => milm.embed(text),
        search: (embedding, topK) => mkb.search("policy-documents", embedding, topK),
        generate: (messages) => milm.chatStream(messages),
      },
    );

    for await (const chunk of stream) {
      if (chunk.delta) {
        sendEvent("delta", { delta: chunk.delta });
      }
      if (chunk.final) {
        // Update session history
        session.messages.push({ role: "user", content: query });
        session.messages.push({
          role: "assistant",
          content: chunk.final.answer,
          citations: chunk.final.citations,
        });
        sendEvent("done", chunk.final);
      }
    }
  } catch (err) {
    sendEvent("error", { message: "An error occurred. Please try again." });
    console.error("Query error:", err);
  } finally {
    res.end();
  }
});
