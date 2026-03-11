import { useEffect, useRef, useState, useCallback } from "react";
import { X, FileText, ChevronRight, ExternalLink } from "lucide-react";
import Markdown from "react-markdown";
import { cn } from "@/lib/utils";
import { PROSE_CLASSES } from "@/lib/content";
import { usePrivacy } from "@/contexts/PrivacyContext";

interface Section {
  chunkIndex: number;
  heading: string;
  sectionPath: string[];
  pageNumber: number;
  content: string;
}

interface SourcePanelProps {
  documentId: string;
  documentName: string;
  sectionPath: string[];
  pageNumber: number;
  onClose: () => void;
}

export function SourcePanel({
  documentId,
  documentName,
  sectionPath,
  pageNumber,
  onClose,
}: SourcePanelProps) {
  const { level: privacyLevel } = usePrivacy();
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const highlightRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (privacyLevel === "vault") {
        const { getLocalChunksForDocument } = await import("@/services/vaultEngine");
        const chunks = await getLocalChunksForDocument(documentId);
        setSections(chunks);
      } else {
        const r = await fetch(`/api/documents/${documentId}/content`, {
          credentials: "same-origin",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { sections: Section[] };
        setSections(data.sections);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
    } finally {
      setLoading(false);
    }
  }, [documentId, privacyLevel]);

  useEffect(() => {
    void fetchContent();
  }, [fetchContent]);

  // Scroll to highlighted section after content loads
  useEffect(() => {
    if (!loading && highlightRef.current) {
      // Slight delay to let the DOM settle
      const timer = setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [loading, sections]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Match the citation to a section
  function isHighlighted(section: Section): boolean {
    // Match by sectionPath if available, otherwise by pageNumber
    if (sectionPath.length > 0) {
      const sectionKey = section.sectionPath.join("/");
      const targetKey = sectionPath.join("/");
      return sectionKey === targetKey;
    }
    return pageNumber > 0 && section.pageNumber === pageNumber;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-[560px] max-w-[90vw]",
          "bg-white border-l border-slate-200 shadow-xl",
          "flex flex-col",
          "animate-slide-in-right",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
            <FileText className="w-4 h-4 text-slate-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              {documentName}
            </h2>
            {sectionPath.length > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                {sectionPath.map((part, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="w-2.5 h-2.5" />}
                    <span>{part}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          {privacyLevel !== "vault" && (
            <a
              href={`/api/documents/${documentId}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex-shrink-0"
              title="View original file"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="text-sm text-red-500 py-8 text-center">{error}</div>
          )}

          {!loading && !error && sections.length === 0 && (
            <div className="text-sm text-slate-400 py-8 text-center">
              No content available for this document.
            </div>
          )}

          {!loading && !error && sections.length > 0 && (
            <div className="space-y-1">
              {sections.map((section) => {
                const highlighted = isHighlighted(section);
                return (
                  <div
                    key={section.chunkIndex}
                    ref={highlighted ? highlightRef : undefined}
                    className={cn(
                      "rounded-lg px-3 py-2 transition-colors",
                      highlighted && "bg-amber-50 ring-1 ring-amber-200",
                    )}
                  >
                    {section.heading && (
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-700">
                          {section.heading}
                        </span>
                        {section.pageNumber > 0 && (
                          <span className="text-[10px] text-slate-400">
                            p. {section.pageNumber}
                          </span>
                        )}
                      </div>
                    )}
                    <div className={cn("text-xs text-slate-600 leading-relaxed", ...PROSE_CLASSES, "prose-p:my-1.5 prose-p:text-xs")}>
                      <Markdown>{section.content}</Markdown>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
