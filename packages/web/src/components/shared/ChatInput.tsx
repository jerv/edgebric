import { forwardRef } from "react";
import { Send, Square, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type SendMode = "chat" | "ai";

interface ChatInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onStop?: () => void;
  /** If provided, enables the Chat/AI toggle pills. */
  onAsk?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  isLoading: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  /** Content rendered above the textarea (e.g. mention picker) */
  overlay?: React.ReactNode;
  /** Controlled send mode. */
  sendMode?: SendMode;
  /** Called when mode changes via toggle. */
  onSendModeChange?: (mode: SendMode) => void;
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { value, onChange, onSubmit, onStop, onAsk, onKeyDown, placeholder, isLoading, isStreaming, disabled, overlay, sendMode, onSendModeChange },
    ref,
  ) {
    const mode = sendMode ?? "chat";
    const hasAsk = !!onAsk;

    function handlePrimaryClick() {
      if (hasAsk && mode === "ai") {
        onAsk!();
      } else {
        onSubmit();
      }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (onKeyDown) {
        onKeyDown(e);
        if (e.defaultPrevented) return;
      }
      if (e.key === "Tab" && hasAsk && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onSendModeChange?.(mode === "chat" ? "ai" : "chat");
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handlePrimaryClick();
      }
    }

    const showStop = isStreaming ?? isLoading;

    const btnBase = "inline-flex items-center justify-center gap-1.5 text-sm leading-6 font-medium transition-colors";

    return (
      <div className="relative">
        {overlay}

        {/* Chat / AI toggle pills */}
        {hasAsk && (
          <div className="flex items-center gap-1 mb-1.5">
            <button
              type="button"
              onClick={() => onSendModeChange?.("chat")}
              className={cn(
                "text-[11px] px-2.5 py-0.5 rounded-full transition-colors flex items-center gap-1",
                mode === "chat" ? "bg-slate-900 text-white dark:bg-gray-100 dark:text-gray-900" : "text-slate-400 hover:text-slate-600 dark:text-gray-500 dark:hover:text-gray-300",
              )}
            >
              <Send className="w-2.5 h-2.5" />
              Chat
            </button>
            <button
              type="button"
              onClick={() => onSendModeChange?.("ai")}
              className={cn(
                "text-[11px] px-2.5 py-0.5 rounded-full transition-colors flex items-center gap-1",
                mode === "ai" ? "bg-slate-900 text-white dark:bg-gray-100 dark:text-gray-900" : "text-slate-400 hover:text-slate-600 dark:text-gray-500 dark:hover:text-gray-300",
              )}
            >
              <Sparkles className="w-2.5 h-2.5" />
              AI
            </button>
            <span className="text-[10px] text-slate-400 dark:text-gray-500 ml-1">Tab to switch</span>
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            ref={ref}
            value={value}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            onInput={(e) => autoResize(e.currentTarget)}
            placeholder={placeholder ?? "Ask a question..."}
            rows={1}
            disabled={disabled}
            className="flex-1 min-w-0 resize-none rounded-xl border border-slate-200 dark:border-gray-700 px-4 py-2.5 text-sm leading-6 text-slate-900 dark:text-gray-100 placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-gray-100 focus:border-transparent max-h-32 overflow-y-auto disabled:opacity-50 dark:bg-gray-900"
          />
          {showStop ? (
            <button
              type="button"
              onClick={onStop}
              className={`${btnBase} self-end rounded-xl px-4 py-2.5 bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 dark:hover:text-red-400 flex-shrink-0`}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePrimaryClick}
              disabled={!value.trim() || disabled}
              className={`${btnBase} self-end rounded-xl px-4 py-2.5 bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-slate-700 dark:hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0`}
            >
              {hasAsk && mode === "ai" ? <Sparkles className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
              Send
            </button>
          )}
        </div>
      </div>
    );
  },
);
