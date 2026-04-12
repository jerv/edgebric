import { MODEL_CATALOG_MAP } from "@edgebric/types";
import type { InstalledModel, ModelCatalogEntry, ModelSupportTier } from "@edgebric/types";

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

export function getModelSupport(tagOrModel: string | InstalledModel): ModelSupportTier {
  if (typeof tagOrModel !== "string") {
    return tagOrModel.support ?? tagOrModel.catalogEntry?.support ?? "community";
  }
  return MODEL_CATALOG_MAP.get(tagOrModel)?.support ?? "community";
}

export function supportLabel(support: ModelSupportTier): string {
  switch (support) {
    case "tested":
      return "Tested";
    case "experimental":
      return "Experimental";
    default:
      return "Community";
  }
}

export function supportClassName(support: ModelSupportTier): string {
  switch (support) {
    case "tested":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800";
    case "experimental":
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-800";
  }
}

export function supportDescription(support: ModelSupportTier): string {
  switch (support) {
    case "tested":
      return "Engineered and tested for Edgebric's full agent flow.";
    case "experimental":
      return "Loadable, but tool use and memory behavior may be degraded.";
    default:
      return "Advanced/manual use only. Edgebric does not guarantee agent reliability here.";
  }
}
