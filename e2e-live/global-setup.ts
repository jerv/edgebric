/**
 * Global setup for live E2E tests.
 *
 * Ensures:
 * 1. The API server is reachable
 * 2. The inference server (llama-server) has a chat model loaded
 * 3. The API knows which model to use
 */

const BASE_URL = process.env["EDGEBRIC_URL"] ?? "http://localhost:3001";
const CHAT_SERVER_URL = process.env["INFERENCE_CHAT_URL"] ?? "http://localhost:8080";

export default async function globalSetup() {
  // 1. Verify API is running
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (!healthRes.ok) {
    throw new Error(`API not reachable at ${BASE_URL}. Start the server first.`);
  }
  const health = await healthRes.json() as { status: string; aiReady: boolean };
  console.log(`API health: ${health.status}, aiReady: ${health.aiReady}`);

  // 2. Check that the chat inference server is reachable
  const chatHealthRes = await fetch(`${CHAT_SERVER_URL}/health`);
  if (!chatHealthRes.ok) {
    throw new Error(`Chat inference server not reachable at ${CHAT_SERVER_URL}`);
  }

  // 3. Check for running model slots
  const slotsRes = await fetch(`${CHAT_SERVER_URL}/slots`);
  if (!slotsRes.ok) {
    throw new Error("Chat inference server has no model slots available. Load a model first.");
  }

  // Use a default model tag since llama-server serves one model at a time
  const modelTag = process.env["CHAT_MODEL"] ?? "qwen3:4b";
  console.log(`Using model: ${modelTag}`);

  // 4. Set the active model in the API
  const setRes = await fetch(`${BASE_URL}/api/admin/models/active`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: modelTag }),
  });
  if (!setRes.ok) {
    console.warn(`Failed to set active model: ${await setRes.text()}`);
  } else {
    console.log(`Active model set to ${modelTag}`);
  }
}
