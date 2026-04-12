import { useEffect, useState } from "react";
import type { ChatActionProposal } from "@edgebric/types";
import { AlertTriangle, CheckSquare2, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  proposal: ChatActionProposal;
  onConfirm: (args: Record<string, unknown>) => Promise<void>;
}

export function ChatActionCard({ proposal, onConfirm }: Props) {
  const [draft, setDraft] = useState<Record<string, unknown>>(proposal.arguments);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDraft(proposal.arguments);
  }, [proposal.id, proposal.arguments]);

  function updateField(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm(draft);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={cn(
      "rounded-2xl border px-4 py-4 space-y-4",
      proposal.destructive
        ? "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20"
        : "border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-950/70",
    )}>
      <div className="flex items-start gap-3">
        <div className={cn(
          "mt-0.5 flex h-8 w-8 items-center justify-center rounded-full",
          proposal.destructive
            ? "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300"
            : "bg-slate-100 text-slate-600 dark:bg-gray-900 dark:text-gray-300",
        )}>
          {proposal.destructive ? <AlertTriangle className="h-4 w-4" /> : <CheckSquare2 className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-gray-100">{proposal.title}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-gray-400">{proposal.summary}</div>
        </div>
      </div>

      <div className="space-y-3">
        {proposal.fields.map((field) => {
          const value = draft[field.key];
          return (
            <label key={field.key} className="block space-y-1.5">
              <div className="text-xs font-medium text-slate-700 dark:text-gray-300">
                {field.label}
                {field.required && <span className="ml-1 text-red-500">*</span>}
              </div>
              {field.input === "textarea" ? (
                <textarea
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  rows={6}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500"
                />
              ) : field.input === "select" ? (
                <select
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500"
                >
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : field.input === "boolean" ? (
                <button
                  type="button"
                  onClick={() => updateField(field.key, !Boolean(value))}
                  className={cn(
                    "inline-flex min-h-[40px] items-center rounded-full border px-3 py-2 text-sm transition",
                    Boolean(value)
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-slate-200 bg-slate-50 text-slate-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300",
                  )}
                >
                  {Boolean(value) ? "Enabled" : "Disabled"}
                </button>
              ) : field.input === "string_list" ? (
                <textarea
                  value={Array.isArray(value) ? value.map((entry) => String(entry)).join(", ") : ""}
                  onChange={(e) => updateField(field.key, e.target.value.split(",").map((entry) => entry.trim()).filter(Boolean))}
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500"
                />
              ) : (
                <input
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500"
                />
              )}
              {field.description && (
                <div className="text-[11px] text-slate-500 dark:text-gray-400">{field.description}</div>
              )}
            </label>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={submitting}
          className={cn(
            "inline-flex min-h-[40px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60",
            proposal.destructive
              ? "bg-red-600 hover:bg-red-700"
              : "bg-slate-900 hover:bg-slate-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200",
          )}
        >
          {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {proposal.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </div>
  );
}
