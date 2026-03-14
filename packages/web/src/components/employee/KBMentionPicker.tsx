import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import type { KnowledgeBase } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { Database, Globe } from "lucide-react";

/** A KB target selected from the mention picker. */
export interface KBTarget {
  id: string;
  name: string;
  datasetName: string;
  type: "organization" | "personal" | "shortcut";
}

/** Imperative handle exposed to parent for keyboard navigation. */
export interface KBMentionPickerHandle {
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
}

/** Built-in shortcuts that appear at the top of the picker. */
const SHORTCUTS: KBTarget[] = [
  { id: "__org__", name: "Organization", datasetName: "", type: "shortcut" },
  { id: "__all__", name: "All knowledge bases", datasetName: "", type: "shortcut" },
];

interface KBMentionPickerProps {
  filter: string;
  knowledgeBases: KnowledgeBase[];
  selected: KBTarget[];
  onSelect: (target: KBTarget) => void;
  onDismiss: () => void;
}

export const KBMentionPicker = forwardRef<KBMentionPickerHandle, KBMentionPickerProps>(
  function KBMentionPicker({ filter, knowledgeBases, selected, onSelect, onDismiss }, ref) {
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const selectedIds = new Set(selected.map((s) => s.id));

    const normalizedFilter = filter.toLowerCase();
    const filteredShortcuts = SHORTCUTS.filter(
      (s) => !selectedIds.has(s.id) && s.name.toLowerCase().includes(normalizedFilter),
    );
    const filteredKBs = knowledgeBases
      .filter(
        (kb) =>
          kb.status === "active" &&
          !selectedIds.has(kb.id) &&
          kb.name.toLowerCase().includes(normalizedFilter),
      )
      .map((kb): KBTarget => ({
        id: kb.id,
        name: kb.name,
        datasetName: kb.datasetName,
        type: kb.type === "personal" ? "personal" : "organization",
      }));

    const allItems = [...filteredShortcuts, ...filteredKBs];

    useEffect(() => {
      setActiveIndex(0);
    }, [filter]);

    useEffect(() => {
      const list = listRef.current;
      if (!list) return;
      // Skip section header divs — count only button elements
      const buttons = list.querySelectorAll("button");
      buttons[activeIndex]?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    // Expose keyboard handler to parent via ref
    useImperativeHandle(ref, () => ({
      handleKeyDown(e: React.KeyboardEvent): boolean {
        if (allItems.length === 0) return false;

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % allItems.length);
            return true;
          case "ArrowUp":
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + allItems.length) % allItems.length);
            return true;
          case "Enter":
          case "Tab":
            e.preventDefault();
            if (allItems[activeIndex]) onSelect(allItems[activeIndex]);
            return true;
          case "Escape":
            e.preventDefault();
            onDismiss();
            return true;
          default:
            return false;
        }
      },
    }), [allItems, activeIndex, onSelect, onDismiss]);

    if (allItems.length === 0) {
      return (
        <div className="absolute left-0 bottom-full mb-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-3 px-3 z-20">
          <p className="text-xs text-slate-400">No matching knowledge bases</p>
        </div>
      );
    }

    const shortcutCount = filteredShortcuts.length;

    return (
      <div className="absolute left-0 bottom-full mb-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-20 max-h-64 overflow-y-auto">
        <div ref={listRef}>
          {shortcutCount > 0 && (
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
              Quick filters
            </div>
          )}
          {filteredShortcuts.map((item, i) => (
            <button
              key={item.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors",
                activeIndex === i ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <Globe className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="truncate">@{item.name}</span>
            </button>
          ))}

          {filteredKBs.length > 0 && (
            <div className={cn("px-3 pt-1.5 pb-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider", shortcutCount > 0 && "border-t border-slate-100 mt-1")}>
              Knowledge Bases
            </div>
          )}
          {filteredKBs.map((item, rawIndex) => {
            const i = shortcutCount + rawIndex;
            return (
              <button
                key={item.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(item);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors",
                  activeIndex === i ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <Database className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="truncate">@{item.name}</span>
                <span className="ml-auto text-[10px] text-slate-300">{item.type === "personal" ? "Personal" : "Org"}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  },
);
