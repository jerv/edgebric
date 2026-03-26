import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import type { DataSource } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { Database, Globe } from "lucide-react";

/** A data source target selected from the mention picker. */
export interface DSTarget {
  id: string;
  name: string;
  datasetName: string;
  type: "organization" | "personal" | "shortcut";
}

/** Imperative handle exposed to parent for keyboard navigation. */
export interface DSMentionPickerHandle {
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
}

/** Built-in shortcuts that appear at the top of the picker. */
const SHORTCUTS: DSTarget[] = [
  { id: "__org__", name: "Organization", datasetName: "", type: "shortcut" },
  { id: "__all__", name: "All data sources", datasetName: "", type: "shortcut" },
];

interface DSMentionPickerProps {
  filter: string;
  dataSources: DataSource[];
  selected: DSTarget[];
  onSelect: (target: DSTarget) => void;
  onDismiss: () => void;
}

export const DSMentionPicker = forwardRef<DSMentionPickerHandle, DSMentionPickerProps>(
  function DSMentionPicker({ filter, dataSources, selected, onSelect, onDismiss }, ref) {
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const selectedIds = new Set(selected.map((s) => s.id));

    const normalizedFilter = filter.toLowerCase();
    const filteredShortcuts = SHORTCUTS.filter(
      (s) => !selectedIds.has(s.id) && s.name.toLowerCase().includes(normalizedFilter),
    );
    const filteredDS = dataSources
      .filter(
        (ds) =>
          ds.status === "active" &&
          !selectedIds.has(ds.id) &&
          ds.name.toLowerCase().includes(normalizedFilter),
      )
      .map((ds): DSTarget => ({
        id: ds.id,
        name: ds.name,
        datasetName: ds.datasetName,
        type: ds.type === "personal" ? "personal" : "organization",
      }));

    const allItems = [...filteredShortcuts, ...filteredDS];

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
        <div className="absolute left-0 bottom-full mb-1 w-64 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg py-3 px-3 z-20">
          <p className="text-xs text-slate-400 dark:text-gray-500">No matching data sources</p>
        </div>
      );
    }

    const shortcutCount = filteredShortcuts.length;

    return (
      <div className="absolute left-0 bottom-full mb-1 w-72 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg py-1 z-20 max-h-64 overflow-y-auto">
        <div ref={listRef}>
          {shortcutCount > 0 && (
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">
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
                activeIndex === i ? "bg-slate-50 dark:bg-gray-900 text-slate-900 dark:text-gray-100" : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
              )}
            >
              <Globe className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
              <span className="truncate">@{item.name}</span>
            </button>
          ))}

          {filteredDS.length > 0 && (
            <div className={cn("px-3 pt-1.5 pb-1 text-[10px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider", shortcutCount > 0 && "border-t border-slate-100 dark:border-gray-800 mt-1")}>
              Data Sources
            </div>
          )}
          {filteredDS.map((item, rawIndex) => {
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
                  activeIndex === i ? "bg-slate-50 dark:bg-gray-900 text-slate-900 dark:text-gray-100" : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                )}
              >
                <Database className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                <span className="truncate">@{item.name}</span>
                <span className="ml-auto text-[10px] text-slate-300 dark:text-gray-600">{item.type === "personal" ? "Personal" : "Org"}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  },
);
