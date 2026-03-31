/**
 * Global setup for live E2E tests.
 *
 * Ensures:
 * 1. The API server is reachable
 * 2. Ollama has a chat model loaded
 * 3. The API knows which model to use
 */

const BASE_URL = process.env["EDGEBRIC_URL"] ?? "http://localhost:3001";
const OLLAMA_URL = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

export default async function globalSetup() {
  // 1. Verify API is running
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (!healthRes.ok) {
    throw new Error(`API not reachable at ${BASE_URL}. Start the server first.`);
  }
  const health = await healthRes.json() as { status: string; aiReady: boolean };
  console.log(`API health: ${health.status}, aiReady: ${health.aiReady}`);

  // 2. Check Ollama for installed models
  const tagsRes = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!tagsRes.ok) {
    throw new Error(`Ollama not reachable at ${OLLAMA_URL}`);
  }
  const { models } = await tagsRes.json() as { models: Array<{ name: string }> };
  const chatModels = models.filter(
    (m) => !m.name.includes("embed") && !m.name.includes("nomic"),
  );
  if (chatModels.length === 0) {
    throw new Error("No chat models installed in Ollama. Install one first (e.g. ollama pull llama3.2:3b)");
  }

  // 3. Load the first available chat model if none are running
  const psRes = await fetch(`${OLLAMA_URL}/api/ps`);
  const { models: running } = await psRes.json() as { models: Array<{ name: string }> };
  const runningChat = running.filter(
    (m) => !m.name.includes("embed") && !m.name.includes("nomic"),
  );

  const modelTag = runningChat.length > 0 ? runningChat[0]!.name : chatModels[0]!.name;

  if (runningChat.length === 0) {
    console.log(`Loading model ${modelTag} into Ollama...`);
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      body: JSON.stringify({ model: modelTag, keep_alive: "30m", prompt: "" }),
    });
    console.log(`Model ${modelTag} loaded.`);
  }

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
