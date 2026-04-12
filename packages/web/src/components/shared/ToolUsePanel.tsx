import { useState } from "react";
import { Wrench, ChevronRight, Circle, LoaderCircle, CheckCircle2, XCircle, SkipForward } from "lucide-react";
import type { ExecutionChecklistItem } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { TOOL_CONFIG, cleanToolName, type ToolUse } from "./toolConfig";

function statusIcon(status: ExecutionChecklistItem["status"]) {
  switch (status) {
    case "running":
      return LoaderCircle;
    case "completed":
      return CheckCircle2;
    case "failed":
      return XCircle;
    case "skipped":
      return SkipForward;
    default:
      return Circle;
  }
}

export function ToolUsePanel({
  toolUses,
  executionPlan,
}: {
  toolUses?: ToolUse[];
  executionPlan?: ExecutionChecklistItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visiblePlan = (executionPlan ?? []).filter((step) => {
    if (step.tool) return true;
    return step.id !== "respond" && step.id !== "retrieve";
  });
  const onlyGenericPlan = visiblePlan.length === 0 && (!toolUses || toolUses.length === 0);
  if (onlyGenericPlan) return null;
  if ((!toolUses || toolUses.length === 0) && visiblePlan.length === 0) return null;

  return (
    <div className="mt-2 mb-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {(visiblePlan.length > 0 ? visiblePlan : toolUses ?? []).map((t, i) => {
          const toolName = "name" in t ? t.name : t.tool;
          if (!toolName) return null;
          const cfg = TOOL_CONFIG[toolName];
          const Icon = cfg?.icon ?? Wrench;
          return (
            <span key={i} className="flex items-center gap-1">
              <Icon className="h-3 w-3" />
              <span>{cfg?.label ?? cleanToolName(toolName)}</span>
            </span>
          );
        })}
        <span>{visiblePlan.length > 0 ? "Context" : "Tools"}</span>
        <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 pl-4 border-l-2 border-muted">
          {visiblePlan.map((step) => {
            const cfg = step.tool ? TOOL_CONFIG[step.tool] : undefined;
            const Icon = step.tool ? (cfg?.icon ?? Wrench) : Wrench;
            const StatusIcon = statusIcon(step.status);
            return (
              <div key={step.id} className="text-xs flex items-center gap-1.5">
                <StatusIcon className={cn(
                  "h-3 w-3 flex-shrink-0",
                  step.status === "running" && "animate-spin text-blue-500",
                  step.status === "completed" && "text-emerald-500",
                  step.status === "failed" && "text-red-500",
                  step.status === "skipped" && "text-slate-400",
                  step.status === "planned" && "text-slate-400",
                )} />
                <Icon className="h-3 w-3 flex-shrink-0" />
                <span className="font-medium text-foreground">{step.title}</span>
                {step.summary && <span className="text-muted-foreground">- {step.summary}</span>}
              </div>
            );
          })}
          {toolUses?.map((tu, i) => {
            const cfg = TOOL_CONFIG[tu.name];
            const Icon = cfg?.icon ?? Wrench;
            return (
              <div key={`${tu.name}-${i}`} className="text-xs flex items-center gap-1.5">
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  tu.result.success ? "bg-emerald-500" : "bg-red-500",
                )} />
                <Icon className="h-3 w-3 flex-shrink-0" />
                <span className="font-medium text-foreground">{cfg?.label ?? cleanToolName(tu.name)}</span>
                <span className="text-muted-foreground">- {tu.result.summary}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
