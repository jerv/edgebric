/**
 * Context usage ring indicator — shows how much of the model's context
 * window is being used by document context and conversation history.
 *
 * Inspired by Claude Code's context usage indicator.
 */

import { cn } from "@/lib/utils";

interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  contextTokens: number;
  historyTokens: number;
  truncated: boolean;
}

export function ContextRing({ usage }: { usage: ContextUsage | null }) {
  if (!usage) return null;

  const pct = Math.min((usage.usedTokens / usage.maxTokens) * 100, 100);

  // Color based on usage level
  const ringColor = pct > 90 ? "text-red-500" : pct > 70 ? "text-amber-500" : "text-emerald-500";
  const bgColor = pct > 90 ? "text-red-100 dark:text-red-950" : pct > 70 ? "text-amber-100 dark:text-amber-950" : "text-slate-200 dark:text-gray-700";

  // SVG ring parameters
  const size = 24;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <div className="group relative flex items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={cn("stroke-current", bgColor)}
        />
        {/* Usage ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className={cn("stroke-current transition-all duration-500", ringColor)}
        />
      </svg>
      {/* Tooltip — anchored right to avoid bleeding off screen edge */}
      <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-50">
        <div className="bg-slate-900 dark:bg-gray-800 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
          <div className="font-medium mb-1">
            Context: {Math.round(pct)}% used
            {usage.truncated && <span className="text-amber-400 ml-1">(truncated)</span>}
          </div>
          <div className="text-slate-300 dark:text-gray-400 space-y-0.5">
            <div className="flex justify-between gap-4">
              <span>Documents:</span>
              <span>{formatTokens(usage.contextTokens)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>History:</span>
              <span>{formatTokens(usage.historyTokens)}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-slate-700 dark:border-gray-600 pt-0.5 mt-0.5">
              <span>Total:</span>
              <span>{formatTokens(usage.usedTokens)} / {formatTokens(usage.maxTokens)}</span>
            </div>
          </div>
        </div>
        <div className="absolute top-full right-2 -mt-1 border-4 border-transparent border-t-slate-900 dark:border-t-gray-800" />
      </div>
    </div>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${tokens}`;
}
