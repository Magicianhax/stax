import "server-only";
import * as Sentry from "@sentry/nextjs";

// Uniform API responses that never leak internals to the client. 4xx messages
// are static and safe to show; 5xx logs the real error server-side and returns
// a generic message (closes the "raw err.message forwarded to client" leak,
// which could otherwise surface key material or stack traces).

export function jsonError(status: number, message: string, headers?: HeadersInit, extra?: Record<string, unknown>): Response {
  return Response.json({ ...extra, error: message }, { status, headers });
}

export const unauthorized = () => jsonError(401, "Please sign in to continue.");

export const badRequest = (message = "Invalid request.") => jsonError(400, message);

export const tooManyRequests = (retryAfter: number) =>
  jsonError(429, "Too many requests. Please slow down a moment.", { "Retry-After": String(retryAfter) }, { code: "rate_limited" });

/**
 * Log the real error server-side (with a scope tag) and return a generic,
 * non-leaking message to the client. Use for all unexpected 5xx paths.
 */
export function serverError(scope: string, err: unknown, status = 500): Response {
  // Server-side error log + Sentry (a no-op without a DSN) — the client gets a
  // generic message. Handled API failures would otherwise never be reported.
  console.error(`[${scope}]`, err);
  Sentry.captureException(err, { tags: { scope }, level: status >= 500 ? "error" : "warning" });
  return jsonError(status, "Something went wrong. Please try again.");
}
