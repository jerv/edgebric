import { useState, useCallback } from "react";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

let toastListeners: Array<(toast: Toast) => void> = [];
let counter = 0;

/** Show a toast from anywhere (doesn't need React context). */
export function showToast(opts: Omit<Toast, "id">) {
  const toast: Toast = { ...opts, id: String(++counter) };
  for (const listener of toastListeners) {
    listener(toast);
  }
}

/** React hook for the Toaster component to subscribe to toasts. */
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Toast) => {
    setToasts((prev) => [...prev, toast]);
    // Auto-dismiss after 5s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Subscribe to global toast events
  useState(() => {
    toastListeners.push(addToast);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== addToast);
    };
  });

  return { toasts, dismiss };
}
