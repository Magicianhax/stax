"use client";

// Root-level error boundary. Replaces the root layout when it (or anything it
// renders) throws, so it must render its own <html>/<body>. Reports to Sentry
// (a no-op without a DSN) and shows a plain, on-brand recovery screen.
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "var(--background)",
          color: "var(--foreground)",
          fontFamily: "var(--font-ui)",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: 420,
            padding: 32,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-lg)",
            boxShadow: "var(--shadow-card)",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              margin: "0 0 10px",
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              fontSize: 28,
              letterSpacing: "-0.01em",
            }}
          >
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 24px", color: "var(--muted)", fontSize: 15, lineHeight: 1.5 }}>
            Stax hit an unexpected error. Nothing was moved or spent. Try again, and if it keeps
            happening, reload the page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 48,
              padding: "0 24px",
              border: 0,
              borderRadius: "var(--r-pill)",
              background: "var(--accent-color)",
              color: "var(--on-accent)",
              fontFamily: "inherit",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p
              style={{
                margin: "20px 0 0",
                color: "var(--muted-2)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              Ref {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
