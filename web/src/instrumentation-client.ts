// Browser-side Sentry. Runs after the document loads and before hydration.
// A no-op when NEXT_PUBLIC_SENTRY_DSN is unset.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DSN, SHARED_OPTIONS } from "@/lib/sentry-shared";

if (SENTRY_DSN) {
  Sentry.init({
    ...SHARED_OPTIONS,
    // Session Replay: never record routinely, sample a slice of sessions that error.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.2,
    integrations: [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
