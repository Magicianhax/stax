// Sentry for the Edge runtime (proxy / edge route handlers).
// Loaded from src/instrumentation.ts; a no-op when NEXT_PUBLIC_SENTRY_DSN is unset.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN, SHARED_OPTIONS } from "@/lib/sentry-shared";

if (SENTRY_DSN) {
  Sentry.init(SHARED_OPTIONS);
}
