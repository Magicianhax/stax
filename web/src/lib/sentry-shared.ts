// Options shared by the browser, Node and Edge Sentry inits. Kept dependency-free
// so it can be bundled into every runtime without pulling in the SDK itself.

import type { ErrorEvent } from "@sentry/nextjs";

/** Set only when monitoring is enabled; every `Sentry.init` is skipped without it. */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

/** Request headers that must never leave the box (auth tokens, Privy session, cookies). */
const DROPPED_HEADER = /^(authorization|cookie|x-privy-)/i;

/** Strips credential-bearing request headers from an event before it is sent. */
export function scrubEvent<E extends ErrorEvent>(event: E): E {
  const headers = event.request?.headers;
  if (headers) {
    for (const name of Object.keys(headers)) {
      if (DROPPED_HEADER.test(name)) delete headers[name];
    }
  }
  return event;
}

/** Init options identical across runtimes. */
export const SHARED_OPTIONS = {
  dsn: SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
} as const;
