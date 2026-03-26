import { useMemo } from "react";
import { Database, AlertTriangle, Server } from "lucide-react";
import type { Citation } from "@edgebric/types";

/** Returns a relative time string like "3 months ago". */
function relativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** 180 days — sources older than this get a staleness warning. */
const STALENESS_DAYS = 180;

interface SourceInfo {
  documentId: string;
  documentName: string;
  sectionPath: string[];
  pageNumber: number;
}

interface CitationListProps {
  citations: Citation[];
  onSourceClick: (source: SourceInfo) => void;
}

function DSMiniAvatar({ avatarUrl, name }: { avatarUrl?: string; name: string }) {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 overflow-hidden flex-shrink-0">
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <Database className="w-2.5 h-2.5 text-blue-500 dark:text-blue-400" />
      )}
    </span>
  );
}

interface GroupedCitation {
  dsName: string;
  dsAvatarUrl?: string;
  sourceNodeName?: string;
  items: { citation: Citation; displayName: string }[];
}

export function CitationList({ citations, onSourceClick }: CitationListProps) {
  if (citations.length === 0) return null;

  const grouped = useMemo(() => {
    const groups: GroupedCitation[] = [];
    const groupMap = new Map<string, GroupedCitation>();

    for (const citation of citations) {
      const dsKey = citation.dataSourceName ?? "__none__";
      const displayName = citation.documentName && citation.documentName !== citation.documentId
        ? citation.documentName
        : "Policy document";

      let group = groupMap.get(dsKey);
      if (!group) {
        group = {
          dsName: citation.dataSourceName ?? "",
          dsAvatarUrl: citation.dataSourceAvatarUrl,
          sourceNodeName: citation.sourceNodeName,
          items: [],
        };
        groupMap.set(dsKey, group);
        groups.push(group);
      }
      group.items.push({ citation, displayName });
    }

    return groups;
  }, [citations]);

  return (
    <div className="space-y-1.5 px-1">
      {grouped.map((group) => (
        <div key={group.dsName || "__none__"}>
          {/* Data source header — only shown once per data source */}
          {group.dsName && (
            <div className="flex items-center gap-1.5 mb-0.5">
              <DSMiniAvatar avatarUrl={group.dsAvatarUrl} name={group.dsName} />
              <span className="text-[11px] text-slate-400 dark:text-gray-500 font-medium">{group.dsName}</span>
              {group.sourceNodeName && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-full">
                  <Server className="w-2.5 h-2.5" />
                  {group.sourceNodeName}
                </span>
              )}
            </div>
          )}

          {/* Individual citations under this data source */}
          <div className={group.dsName ? "pl-[22px] space-y-px" : "space-y-px"}>
            {group.items.map(({ citation, displayName }, j) => {
              const breadcrumb = citation.sectionPath.length > 0
                ? citation.sectionPath.join(" › ")
                : null;
              const page = citation.pageNumber > 0 ? `p.${citation.pageNumber}` : null;

              // Freshness indicator
              const updatedAt = citation.documentUpdatedAt;
              const updatedLabel = updatedAt ? relativeTime(updatedAt) : null;
              const isStale = updatedAt
                ? (Date.now() - new Date(updatedAt).getTime()) > STALENESS_DAYS * 24 * 60 * 60 * 1000
                : false;

              const detail = [breadcrumb, page, updatedLabel].filter(Boolean).join(" · ");

              const fullText = [`[${displayName}]`, detail].filter(Boolean).join(" ");
              return (
                <button
                  key={j}
                  className="text-xs text-slate-500 dark:text-gray-400 flex items-center gap-1 text-left hover:text-slate-700 dark:hover:text-gray-300 transition-colors group/cite truncate max-w-full"
                  title={isStale ? `${fullText} (may be outdated)` : fullText}
                  onClick={() => onSourceClick({
                    documentId: citation.documentId,
                    documentName: displayName,
                    sectionPath: citation.sectionPath,
                    pageNumber: citation.pageNumber,
                  })}
                >
                  <span className="text-slate-300 dark:text-gray-600 flex-shrink-0">↳</span>
                  {isStale && (
                    <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                  )}
                  <span className="font-medium text-slate-700 dark:text-gray-300 group-hover/cite:underline flex-shrink-0">
                    [{displayName}]
                  </span>
                  {detail && (
                    <span className={`truncate ${isStale ? "text-amber-500 dark:text-amber-400" : "text-slate-400 dark:text-gray-500"}`}>{detail}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
