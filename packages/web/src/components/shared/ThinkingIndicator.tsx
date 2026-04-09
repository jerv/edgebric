import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const THINKING_WORDS = [
  "Thinking",
  "Searching data sources",
  "Reading documents",
  "Analyzing",
  "Composing answer",
  "Reviewing data sources",
  "Cross-referencing",
  "Synthesizing",
];

export function ThinkingIndicator({ queuePosition }: { queuePosition?: number | null }) {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % THINKING_WORDS.length);
        setFade(true);
      }, 200);
    }, 2400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:300ms]" />
      </div>
      {queuePosition != null && queuePosition > 0 ? (
        <span className="text-xs text-amber-500 dark:text-amber-400">
          Queued ({queuePosition} {queuePosition === 1 ? "request" : "requests"} ahead)
        </span>
      ) : (
        <span
          className={cn(
            "text-xs text-slate-400 dark:text-gray-500 transition-opacity duration-200",
            fade ? "opacity-100" : "opacity-0",
          )}
        >
          {THINKING_WORDS[index]}
        </span>
      )}
    </div>
  );
}
