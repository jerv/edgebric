export interface ModelMeta {
  family: string;
  label: string;
  spec: string;
}

export const MODEL_META: Record<string, ModelMeta> = {
  "qwen3.5-4b":      { family: "Qwen", label: "Fast",              spec: "4B" },
  "qwen3.5-4b.gguf": { family: "Qwen", label: "Fast",              spec: "4B" },
  "qwen3.5-9b":      { family: "Qwen", label: "Thinking (Slower)", spec: "9B" },
  "qwen3.5-9b.gguf": { family: "Qwen", label: "Thinking (Slower)", spec: "9B" },
  "qwen2.5-7b":      { family: "Qwen", label: "Balanced",          spec: "7B" },
  "qwen2.5-7b.gguf": { family: "Qwen", label: "Balanced",          spec: "7B" },
};

export function modelMeta(id: string): ModelMeta {
  return MODEL_META[id] ?? { family: id, label: "", spec: "" };
}

/** Full label for admin UI: "Qwen -- Fast . qwen3.5-4b" */
export function adminLabel(id: string): string {
  const m = MODEL_META[id];
  if (!m) return id;
  return `${m.family} — ${m.label} · ${id}`;
}

/** Short label for employee UI: "Fast" */
export function employeeLabel(id: string): string {
  return MODEL_META[id]?.label ?? id;
}
