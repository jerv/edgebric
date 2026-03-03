import { Router } from "express";
import { issueToken, revokeToken, listTokens } from "../middleware/deviceToken.js";
import { createAdminSession, requireAdmin } from "../middleware/adminAuth.js";

export const authRouter = Router();

/**
 * POST /api/auth/token
 * Issue an anonymous device token to a new employee device.
 * Called once at first launch on the company network.
 * No identity required — no identity stored.
 */
authRouter.post("/token", (_req, res) => {
  const token = issueToken();
  res.json({ token });
});

/**
 * POST /api/auth/admin
 * Admin login — returns a session token.
 */
authRouter.post("/admin", (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).json({ error: "password required" });
    return;
  }
  const token = createAdminSession(password);
  if (!token) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  res.json({ token });
});

/**
 * GET /api/auth/devices (admin only)
 * List all device tokens — for admin management panel.
 */
authRouter.get("/devices", requireAdmin, (_req, res) => {
  res.json(listTokens());
});

/**
 * DELETE /api/auth/devices/:id (admin only)
 * Revoke a device token (lost device, terminated employee).
 */
authRouter.delete("/devices/:id", requireAdmin, (req, res) => {
  const success = revokeToken(req.params["id"] ?? "");
  if (!success) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  res.status(204).send();
});
