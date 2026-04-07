/**
 * Memory API Routes — CRUD for user memory entries + enable/disable toggle.
 */
import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  saveMemory,
  listMemories,
  getMemory,
  updateMemory,
  deleteMemory,
  isMemoryEnabled,
} from "../services/memoryStore.js";
import {
  getIntegrationConfig,
  setIntegrationConfig,
} from "../services/integrationConfigStore.js";

// ─── Schemas ────────────────────────────────────────────────────────────────

const createMemorySchema = z.object({
  content: z.string().min(1, "Content is required").max(500, "Content too long (max 500 chars)"),
  category: z.enum(["preference", "fact", "instruction"]),
  confidence: z.number().min(0).max(1).optional().default(1.0),
});

const updateMemorySchema = z.object({
  content: z.string().min(1).max(500).optional(),
  category: z.enum(["preference", "fact", "instruction"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const toggleMemorySchema = z.object({
  enabled: z.boolean(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

export const memoryRouter: IRouter = Router();

memoryRouter.use(requireOrg);

// GET /api/memory — list all memories for the current user
memoryRouter.get("/", (req, res) => {
  if (!isMemoryEnabled()) {
    res.json({ enabled: false, memories: [] });
    return;
  }

  const memories = listMemories(req.session.orgId, req.session.email);
  res.json({
    enabled: true,
    memories: memories.map((m) => ({
      id: m.id,
      content: m.content,
      category: m.category,
      confidence: m.confidence,
      source: m.source,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  });
});

// POST /api/memory — create a memory manually
memoryRouter.post("/", validateBody(createMemorySchema), async (req, res) => {
  if (!isMemoryEnabled()) {
    res.status(403).json({ error: "Memory is disabled" });
    return;
  }

  const { content, category, confidence } = req.body as z.infer<typeof createMemorySchema>;

  const entry = await saveMemory({
    content,
    category,
    confidence,
    source: "explicit",
    orgId: req.session.orgId,
    userId: req.session.email,
  });

  res.status(201).json({
    id: entry.id,
    content: entry.content,
    category: entry.category,
    confidence: entry.confidence,
    source: entry.source,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  });
});

// PUT /api/memory/:id — update a memory
memoryRouter.put("/:id", validateBody(updateMemorySchema), async (req, res) => {
  if (!isMemoryEnabled()) {
    res.status(403).json({ error: "Memory is disabled" });
    return;
  }

  const id = req.params["id"] as string;
  const updates = req.body as z.infer<typeof updateMemorySchema>;

  // Verify the memory exists and belongs to this user
  const existing = getMemory(id);
  if (!existing) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }

  const updated = await updateMemory(id, updates, req.session.orgId, req.session.email);
  if (!updated) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }

  res.json({
    id: updated.id,
    content: updated.content,
    category: updated.category,
    confidence: updated.confidence,
    source: updated.source,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

// DELETE /api/memory/:id — delete a memory
memoryRouter.delete("/:id", (req, res) => {
  const id = req.params["id"] as string;

  const existing = getMemory(id);
  if (!existing) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }

  const deleted = deleteMemory(id, req.session.orgId, req.session.email);
  if (!deleted) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }

  res.json({ deleted: true });
});

// PATCH /api/memory/toggle — enable/disable memory for the org
memoryRouter.patch("/toggle", validateBody(toggleMemorySchema), (req, res) => {
  const { enabled } = req.body as z.infer<typeof toggleMemorySchema>;

  const cfg = getIntegrationConfig();
  setIntegrationConfig({ ...cfg, memoryEnabled: enabled } as typeof cfg & { memoryEnabled: boolean });

  res.json({ enabled });
});
