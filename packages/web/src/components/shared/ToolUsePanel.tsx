import { useState } from "react";
import { Wrench, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOOL_CONFIG, cleanToolName, type ToolUse } from "./toolConfig";

export function ToolUsePanel({ toolUses }: { toolUses: ToolUse[] | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!toolUses || toolUses.length === 0) return null;

  return (
    <div className="mt-2 mb-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {toolUses.map((t, i) => {
          const cfg = TOOL_CONFIG[t.name];
          const Icon = cfg?.icon ?? Wrench;
          return (
            <span key={i} className="flex items-center gap-1">
              <Wrench className="h-3 w-3" />
              <Icon className="h-3 w-3" />
              <span>{cfg?.label ?? cleanToolName(t.name)}</span>
            </span>
          );
        })}
        <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 pl-4 border-l-2 border-muted">
          {toolUses.map((tu, i) => {
            const cfg = TOOL_CONFIG[tu.name];
            const Icon = cfg?.icon ?? Wrench;
            return (
              <div key={i} className="text-xs flex items-center gap-1.5">
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  tu.result.success ? "bg-emerald-500" : "bg-red-500",
                )} />
                <Icon className="h-3 w-3 flex-shrink-0" />
                <span className="font-medium text-foreground">{cfg?.label ?? cleanToolName(tu.name)}</span>
                <span className="text-muted-foreground">— {tu.result.summary}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
