import { forwardRef } from "react";
import { Send, Square } from "lucide-react";

interface ChatInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onStop?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  isLoading: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  /** Content rendered above the textarea (e.g. mention picker) */
  overlay?: React.ReactNode;
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { value, onChange, onSubmit, onStop, onKeyDown, placeholder, isLoading, isStreaming, disabled, overlay },
    ref,
  ) {
    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (onKeyDown) {
        onKeyDown(e);
        if (e.defaultPrevented) return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
      }
    }

    const showStop = isStreaming ?? isLoading;

    const btnClass = "self-end inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm leading-6 font-medium transition-colors flex-shrink-0";

    return (
      <div className="relative">
        {overlay}
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
            className="flex-1 min-w-0 resize-none rounded-xl border border-slate-200 px-4 py-2.5 text-sm leading-6 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent max-h-32 overflow-y-auto disabled:opacity-50"
          />
          {showStop ? (
            <button
              type="button"
              onClick={onStop}
              className={`${btnClass} bg-slate-100 text-slate-700 border border-slate-200 hover:bg-red-50 hover:text-red-600`}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              onClick={(e) => { if (!e.currentTarget.form) { e.preventDefault(); onSubmit(); } }}
              disabled={!value.trim() || disabled}
              className={`${btnClass} bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          )}
        </div>
      </div>
    );
  },
);
