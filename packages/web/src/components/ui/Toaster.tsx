import { useToast } from "@/hooks/useToast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            animate-slide-in-right rounded-lg border px-4 py-3 shadow-lg
            ${toast.variant === "destructive"
              ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-900 dark:text-red-300"
              : "border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100"
            }
          `}
          role="alert"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{toast.title}</p>
              {toast.description && (
                <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">{toast.description}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="shrink-0 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
              aria-label="Dismiss"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
