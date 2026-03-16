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

    return (
      <div className="flex gap-2 items-end">
        <div className="flex-1 relative">
          {overlay}
          <textarea
            ref={ref}
            value={value}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "Ask a question..."}
            rows={1}
            disabled={disabled}
            className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent max-h-32 overflow-y-auto disabled:opacity-50"
            style={{ height: "auto" }}
            onInput={(e) => {
              const target = e.currentTarget;
              target.style.height = "auto";
              target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
            }}
          />
        </div>
        {showStop ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 rounded-xl px-4 h-[42px] text-sm font-medium hover:bg-red-50 hover:text-red-600 hover:border-red-200 border border-slate-200 transition-colors flex-shrink-0"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            onClick={(e) => { if (!e.currentTarget.form) { e.preventDefault(); onSubmit(); } }}
            disabled={!value.trim() || disabled}
            className="inline-flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-xl px-4 h-[42px] text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        )}
      </div>
    );
  },
);
