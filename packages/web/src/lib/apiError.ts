import { showToast } from "@/hooks/useToast";
import { getLoginUrl } from "@/lib/api";

/**
 * Handle API response errors with toast notifications.
 * Call this after any fetch() that might fail.
 *
 * Returns the parsed JSON body on success, or null on error (after showing a toast).
 */
export async function handleApiResponse<T = unknown>(
  response: Response,
  context?: string,
): Promise<T | null> {
  if (response.ok) {
    // Some endpoints return empty body (204, etc.)
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (null as T);
  }

  // Session expired — redirect to login
  if (response.status === 401) {
    showToast({
      title: "Session expired",
      description: "Please sign in again.",
      variant: "destructive",
    });
    // Give the toast a moment to appear before redirecting
    setTimeout(() => {
      window.location.href = getLoginUrl();
    }, 1500);
    return null;
  }

  // Org not selected
  if (response.status === 428) {
    showToast({
      title: "Organization required",
      description: "Please select an organization to continue.",
      variant: "destructive",
    });
    setTimeout(() => {
      window.location.reload();
    }, 1500);
    return null;
  }

  // Parse error body
  let errorMessage = "An unexpected error occurred";
  try {
    const body = await response.json();
    errorMessage = body.error ?? body.message ?? errorMessage;
  } catch {
    // couldn't parse JSON error body
  }

  const title = context ? `${context} failed` : "Error";

  if (response.status === 403) {
    showToast({ title, description: errorMessage, variant: "destructive" });
  } else if (response.status === 429) {
    showToast({
      title: "Too many requests",
      description: "Please wait a moment before trying again.",
      variant: "destructive",
    });
  } else if (response.status >= 500) {
    showToast({
      title: "Server error",
      description: "Something went wrong on our end. Please try again.",
      variant: "destructive",
    });
  } else {
    showToast({ title, description: errorMessage, variant: "destructive" });
  }

  return null;
}

/**
 * Wrap a fetch call with error handling + toast.
 * Returns null on error (after showing toast).
 */
export async function apiFetch<T = unknown>(
  url: string,
  init?: RequestInit,
  context?: string,
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...init,
    });
    return handleApiResponse<T>(response, context);
  } catch (err) {
    // Network error (offline, DNS failure, etc.)
    const isOffline = !navigator.onLine;
    showToast({
      title: isOffline ? "You're offline" : "Connection failed",
      description: isOffline
        ? "Check your network connection and try again."
        : err instanceof Error ? err.message : "Could not reach the server.",
      variant: "destructive",
    });
    return null;
  }
}
