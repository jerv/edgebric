/**
 * Global fetch interceptor — CSRF protection + session expiry detection.
 *
 * Patches globalThis.fetch to:
 * 1. Attach the CSRF token on state-changing requests (POST, PUT, PATCH, DELETE)
 * 2. Detect 401 responses and redirect to login (session expired)
 *
 * Import this module once at app startup (e.g. in main.tsx) — no other
 * changes needed. All existing fetch() calls get protection for free.
 */
import { showToast } from "@/hooks/useToast";

function getCsrfToken(): string | undefined {
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith("edgebric.csrf="));
  return match?.split("=")[1];
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const originalFetch = globalThis.fetch;

let sessionExpiredShown = false;

globalThis.fetch = async function interceptedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();

  // Attach CSRF token on state-changing requests
  if (!SAFE_METHODS.has(method)) {
    const token = getCsrfToken();
    if (token) {
      const headers = new Headers(init?.headers);
      headers.set("x-csrf-token", token);
      init = { ...init, headers };
    }
  }

  const response = await originalFetch(input, init);

  // Detect session expiry — but skip for the /auth/me probe (it's expected to 401)
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (response.status === 401 && !url.includes("/api/auth/") && !sessionExpiredShown) {
    sessionExpiredShown = true;
    showToast({
      title: "Session expired",
      description: "Please sign in again.",
      variant: "destructive",
    });
    setTimeout(() => {
      window.location.href = "/api/auth/login";
    }, 2000);
  }

  return response;
};
