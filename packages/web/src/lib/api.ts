/**
 * CSRF protection — global fetch interceptor.
 *
 * Patches globalThis.fetch to automatically attach the CSRF token from
 * the `edgebric.csrf` cookie as the `x-csrf-token` header on all
 * state-changing requests (POST, PUT, PATCH, DELETE).
 *
 * Import this module once at app startup (e.g. in main.tsx) — no other
 * changes needed. All existing fetch() calls get CSRF protection for free.
 */

function getCsrfToken(): string | undefined {
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith("edgebric.csrf="));
  return match?.split("=")[1];
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const originalFetch = globalThis.fetch;

globalThis.fetch = function csrfFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();

  if (!SAFE_METHODS.has(method)) {
    const token = getCsrfToken();
    if (token) {
      const headers = new Headers(init?.headers);
      headers.set("x-csrf-token", token);
      return originalFetch(input, { ...init, headers });
    }
  }

  return originalFetch(input, init);
};
