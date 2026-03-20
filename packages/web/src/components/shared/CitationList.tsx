import { useMemo } from "react";
import { Database } from "lucide-react";
import type { Citation } from "@edgebric/types";

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

function KBMiniAvatar({ avatarUrl, name }: { avatarUrl?: string; name: string }) {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 overflow-hidden flex-shrink-0">
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <Database className="w-2.5 h-2.5 text-slate-400 dark:text-gray-500" />
      )}
    </span>
  );
}

interface GroupedCitation {
  kbName: string;
  kbAvatarUrl?: string;
  items: { citation: Citation; displayName: string }[];
}

export function CitationList({ citations, onSourceClick }: CitationListProps) {
  if (citations.length === 0) return null;

  const grouped = useMemo(() => {
    const groups: GroupedCitation[] = [];
    const groupMap = new Map<string, GroupedCitation>();

    for (const citation of citations) {
      const kbKey = citation.knowledgeBaseName ?? "__none__";
      const displayName = citation.documentName && citation.documentName !== citation.documentId
        ? citation.documentName
        : "Policy document";

      let group = groupMap.get(kbKey);
      if (!group) {
        group = {
          kbName: citation.knowledgeBaseName ?? "",
          kbAvatarUrl: citation.knowledgeBaseAvatarUrl,
          items: [],
        };
        groupMap.set(kbKey, group);
        groups.push(group);
      }
      group.items.push({ citation, displayName });
    }

    return groups;
  }, [citations]);

  return (
    <div className="space-y-1.5 px-1">
      {grouped.map((group) => (
        <div key={group.kbName || "__none__"}>
          {/* KB header — only shown once per KB */}
          {group.kbName && (
            <div className="flex items-center gap-1.5 mb-0.5">
              <KBMiniAvatar avatarUrl={group.kbAvatarUrl} name={group.kbName} />
              <span className="text-[11px] text-slate-400 dark:text-gray-500 font-medium">{group.kbName}</span>
            </div>
          )}

          {/* Individual citations under this KB */}
          <div className={group.kbName ? "pl-[22px] space-y-px" : "space-y-px"}>
            {group.items.map(({ citation, displayName }, j) => {
              const breadcrumb = citation.sectionPath.length > 0
                ? citation.sectionPath.join(" › ")
                : null;
              const page = citation.pageNumber > 0 ? `p.${citation.pageNumber}` : null;
              const detail = [breadcrumb, page].filter(Boolean).join(" · ");

              const fullText = [`[${displayName}]`, detail].filter(Boolean).join(" ");
              return (
                <button
                  key={j}
                  className="text-xs text-slate-500 dark:text-gray-400 flex items-center gap-1 text-left hover:text-slate-700 dark:hover:text-gray-300 transition-colors group/cite truncate max-w-full"
                  title={fullText}
                  onClick={() => onSourceClick({
                    documentId: citation.documentId,
                    documentName: displayName,
                    sectionPath: citation.sectionPath,
                    pageNumber: citation.pageNumber,
                  })}
                >
                  <span className="text-slate-300 dark:text-gray-600 flex-shrink-0">↳</span>
                  <span className="font-medium text-slate-700 dark:text-gray-300 group-hover/cite:underline flex-shrink-0">
                    [{displayName}]
                  </span>
                  {detail && (
                    <span className="text-slate-400 dark:text-gray-500 truncate">{detail}</span>
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
