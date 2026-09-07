// Next.js server instrumentation hook. Registers Sentry for whichever runtime is
// booting and forwards server-side request errors to it. Everything inside is a
// no-op when NEXT_PUBLIC_SENTRY_DSN is unset (see sentry.*.config.ts).
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
