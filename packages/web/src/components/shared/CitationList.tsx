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

export function CitationList({ citations, onSourceClick }: CitationListProps) {
  if (citations.length === 0) return null;

  return (
    <div className="space-y-1 px-1">
      {citations.map((citation, j) => {
        const name = citation.documentName && citation.documentName !== citation.documentId
          ? citation.documentName
          : "Policy document";

        return (
          <button
            key={j}
            className="text-xs text-slate-500 flex items-start gap-2 text-left hover:text-slate-700 transition-colors group/cite"
            onClick={() => onSourceClick({
              documentId: citation.documentId,
              documentName: name,
              sectionPath: citation.sectionPath,
              pageNumber: citation.pageNumber,
            })}
          >
            <span className="text-slate-300 mt-0.5 flex-shrink-0">↳</span>
            <span>
              <span className="font-medium text-slate-700 group-hover/cite:underline">
                {name}
              </span>
              {citation.sectionPath.length > 0 && (
                <span className="text-slate-400"> · {citation.sectionPath.join(" › ")}</span>
              )}
              {citation.pageNumber > 0 && (
                <span className="text-slate-400"> · p. {citation.pageNumber}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
