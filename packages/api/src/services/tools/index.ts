/**
 * Tool Registration — registers all tools with the tool runner.
 * Import this module to make all tools available.
 */
import { registerKnowledgeTools } from "./knowledge.js";
import { registerWebTools } from "./web.js";

let registered = false;

export function registerAllTools(): void {
  if (registered) return;
  registered = true;
  registerKnowledgeTools();
  registerWebTools();
}
