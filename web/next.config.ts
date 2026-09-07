import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Baseline HTTP security headers. The CSP is intentionally limited to
// `frame-ancestors 'none'` (anti-clickjacking — critical for a money app) so it
// does NOT constrain script/style/connect sources; a full source-locked CSP is a
// larger effort because Privy/wagmi/Pimlico/Anthropic each need allow-listed
// origins and the UI uses many inline styles. Everything else below is safe to
// apply globally today.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

// ── Subdomains ────────────────────────────────────────────────────────────────
// One deployment serves four hosts. Each product host rewrites its root to the
// matching route (so app.stax.best/ IS /app), and the marketing host redirects
// the old paths to the subdomains. Hosts default to the production names so the
// rewrites can be exercised locally with a `Host:` header; the redirects only
// switch on once the absolute origins are configured (i.e. DNS is live).
const hostOf = (url: string | undefined, fallback: string) => {
  try {
    return url ? new URL(url).host : fallback;
  } catch {
    return fallback;
  }
};
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
const BETA_URL = process.env.NEXT_PUBLIC_BETA_URL;
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL;
const APP_HOST = hostOf(APP_URL, "app.stax.best");
const BETA_HOST = hostOf(BETA_URL, "beta.stax.best");
const ADMIN_HOST = hostOf(ADMIN_URL, "admin.stax.best");
const SITE_HOSTS = ["www.stax.best", "stax.best"];

// Paths a product host must still serve as-is (assets, API, PWA files, real routes).
const PASSTHROUGH = "api|_next|sw\\.js|manifest\\.webmanifest|offline|brand|icons|favicon\\.ico|icon|apple-icon|opengraph-image|twitter-image|robots\\.txt|sitemap\\.xml|llms\\.txt|app|beta|admin|demo";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // Never cache the worker file itself, so a CACHE_VERSION bump deploys instantly.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },

  async rewrites() {
    const host = (value: string) => [{ type: "host" as const, value }];
    return {
      beforeFiles: [
        // app.stax.best → the app (any unknown path on this host opens the app too)
        { source: "/", has: host(APP_HOST), destination: "/app" },
        { source: `/:path((?!${PASSTHROUGH})[^/]*)`, has: host(APP_HOST), destination: "/app" },
        // beta.stax.best → the waitlist page
        { source: "/", has: host(BETA_HOST), destination: "/beta" },
        // admin.stax.best → the console
        { source: "/", has: host(ADMIN_HOST), destination: "/admin/beta" },
        { source: "/beta", has: host(ADMIN_HOST), destination: "/admin/beta" },
      ],
    };
  },

  async redirects() {
    if (!APP_URL && !BETA_URL && !ADMIN_URL) return [];
    const out = [];
    for (const site of SITE_HOSTS) {
      const has = [{ type: "host" as const, value: site }];
      if (APP_URL) out.push({ source: "/app", has, destination: `${APP_URL}/`, permanent: true });
      if (BETA_URL) out.push({ source: "/beta", has, destination: `${BETA_URL}/`, permanent: true });
      if (ADMIN_URL) out.push({ source: "/admin/:path*", has, destination: `${ADMIN_URL}/`, permanent: false });
    }
    return out;
  },
};

// Sentry build plugin. Inert without credentials: builds stay quiet, and source
// maps are only uploaded when SENTRY_AUTH_TOKEN is present (Vercel env, server-only).
// Runtime init lives in src/instrumentation*.ts and is skipped without a DSN.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
