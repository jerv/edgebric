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
});

// GET /api/admin/integrations — get integration config
integrationsRouter.get("/", (_req, res) => {
  const config = getIntegrationConfig();
  res.json(config);
});

// PUT /api/admin/integrations — update integration config
integrationsRouter.put("/", validateBody(updateConfigSchema), (req, res) => {
  const current = getIntegrationConfig();
  const merged = { ...current, ...req.body };
  setIntegrationConfig(merged);
  res.json(merged);
});
