import { MODEL_CATALOG_MAP } from "@edgebric/types";
import type { ModelCatalogEntry } from "@edgebric/types";

export interface ModelMeta {
  family: string;
  label: string;
  spec: string;
}

/** Derive ModelMeta from the shared catalog. Falls back gracefully for community models. */
export function modelMeta(tag: string): ModelMeta {
  const entry = MODEL_CATALOG_MAP.get(tag);
  if (entry) {
    return { family: entry.name, label: entry.description.split(".")[0]!, spec: entry.paramCount };
  }
  // Community model — extract what we can from the tag
  const parts = tag.split(":");
  const name = parts[0] ?? tag;
  const variant = parts[1] ?? "";
  return { family: name, label: "Community model", spec: variant };
}

/** Full label for admin UI: "Qwen 3 · 4B" */
export function adminLabel(tag: string): string {
  const entry = MODEL_CATALOG_MAP.get(tag);
  if (entry) return `${entry.name} · ${entry.paramCount}`;
  return tag;
}

/** Short label for employee UI: "Qwen 3" */
export function employeeLabel(tag: string): string {
  const entry = MODEL_CATALOG_MAP.get(tag);
  return entry?.name ?? tag;
}

/** Get the catalog entry for a tag, if it exists. */
export function getCatalogEntry(tag: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG_MAP.get(tag);
}
