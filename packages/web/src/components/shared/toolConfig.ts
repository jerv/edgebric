import {
  Search,
  FolderOpen,
  FileSearch,
  FileText,
  Plus,
  Upload,
  Trash2,
  Shield,
  Save,
  GitCompare,
  BookCheck,
  Link2,
  Globe,
  type LucideIcon,
} from "lucide-react";
import type { ToolUseRecord } from "@edgebric/types";

export const TOOL_CONFIG: Record<string, { label: string; icon: LucideIcon }> = {
  search_knowledge: { label: "Search Knowledge", icon: Search },
  list_sources: { label: "List Sources", icon: FolderOpen },
  list_documents: { label: "List Documents", icon: FileSearch },
  get_source_summary: { label: "Source Summary", icon: FileText },
  create_source: { label: "Create Source", icon: Plus },
  upload_document: { label: "Upload Document", icon: Upload },
  delete_document: { label: "Delete Document", icon: Trash2 },
  delete_source: { label: "Delete Source", icon: Trash2 },
  save_to_vault: { label: "Save to Vault", icon: Shield },
  save_memory: { label: "Save Memory", icon: Save },
  compare_documents: { label: "Compare Documents", icon: GitCompare },
  cite_check: { label: "Verify Claim", icon: BookCheck },
  find_related: { label: "Find Related", icon: Link2 },
  web_search: { label: "Web Search", icon: Globe },
  read_url: { label: "Read URL", icon: Globe },
};

/** Convert any_tool_name to Any Tool Name for display when no config entry exists. */
export function cleanToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ToolUse = ToolUseRecord;
