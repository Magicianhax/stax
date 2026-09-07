// Sentry for the Edge runtime (proxy / edge route handlers).
// Loaded from src/instrumentation.ts; a no-op when NEXT_PUBLIC_SENTRY_DSN is unset.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN, SHARED_OPTIONS, scrubEvent } from "@/lib/sentry-shared";
import { scrubServerEvent } from "@/lib/server/sentryScrub";

if (SENTRY_DSN) {
  // Shared header drop, then the server secret scrub (RPC tokens, DB URLs, keys).
  Sentry.init({ ...SHARED_OPTIONS, beforeSend: (event) => scrubServerEvent(scrubEvent(event)) });
}
