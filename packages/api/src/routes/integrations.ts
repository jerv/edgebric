import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";

import { requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  getIntegrationConfig,
  setIntegrationConfig,
} from "../services/integrationConfigStore.js";

export const integrationsRouter: IRouter = Router();

integrationsRouter.use(requireAdmin);

const updateConfigSchema = z.object({
  privateModeEnabled: z.boolean().optional(),
  vaultModeEnabled: z.boolean().optional(),
  generalAnswersEnabled: z.boolean().optional(),
  stalenessThresholdDays: z.number().int().positive().optional(),
  googleDriveClientId: z.string().optional(),
  googleDriveClientSecret: z.string().optional(),
  onedriveClientId: z.string().optional(),
  onedriveClientSecret: z.string().optional(),
  confluenceClientId: z.string().optional(),
  confluenceClientSecret: z.string().optional(),
  notionClientId: z.string().optional(),
  notionClientSecret: z.string().optional(),
  ragDecompose: z.boolean().optional(),
  ragRerank: z.boolean().optional(),
  ragIterativeRetrieval: z.boolean().optional(),
  telegramEnabled: z.boolean().optional(),
  telegramBotToken: z.string().optional(),
  telegramWebhookSecret: z.string().optional(),
  telegramWebhookRegistered: z.boolean().optional(),
}).strict();

// GET /api/admin/integrations — get integration config
integrationsRouter.get("/", (_req, res) => {
  const config = getIntegrationConfig();
  res.json(config);
});

// PUT /api/admin/integrations — update integration config
integrationsRouter.put("/", validateBody(updateConfigSchema), (req, res) => {
  const current = getIntegrationConfig();
  const validated = updateConfigSchema.parse(req.body);
  // Use null-prototype object to prevent prototype pollution
  const merged = Object.assign(Object.create(null), current, validated);
  setIntegrationConfig(merged);
  res.json(merged);
});
