// Runs in the Node and Edge runtimes only (imported by sentry.*.config.ts); never in the browser.
// Server-side secret scrubber for Sentry events. Error messages routinely carry
// things we never want in a third-party dashboard: viem embeds the RPC URL
// (which holds the CDP token) in HttpRequestError, pg can echo connection
// details, and explorer/aggregator clients put keyed URLs in their errors. Every
// string on the event is passed through here before it leaves the box.
import type { ErrorEvent } from "@sentry/nextjs";

const SECRET_ENV = [
  "BASE_RPC_URL",
  "MANTLE_RPC_URL",
  "NEXT_PUBLIC_BASE_RPC_URL",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "ETHERSCAN_API_KEY",
  "ALCHEMY_API_KEY",
  "PIMLICO_API_KEY",
  "RELAY_API_KEY",
  "KYBER_CLIENT_ID",
  "PRIVY_APP_SECRET",
  "ANTHROPIC_API_KEY",
  "CRON_SECRET",
  "AUTOPILOT_CRON_SECRET",
  "SENTRY_AUTH_TOKEN",
] as const;

/** Exact secret values present in this process (only ones long enough to be unambiguous). */
function secretValues(): string[] {
  const out: string[] = [];
  for (const name of SECRET_ENV) {
    const v = process.env[name];
    if (v && v.length >= 12) out.push(v);
    // Keyed URLs: also redact the path/query token on its own (the part after the host).
    if (v && /^https?:\/\//.test(v)) {
      try {
        const u = new URL(v);
        const tail = (u.pathname + u.search).replace(/^\/+/, "");
        if (tail.length >= 12) out.push(tail);
        if (u.password) out.push(u.password);
      } catch {
        /* not a URL */
      }
    }
  }
  return out;
}

// Generic shapes that are secrets even when we don't hold the value in env.
const PATTERNS: RegExp[] = [
  /(api[_-]?key|apikey|token|secret|password|authorization)=([^&\s"']+)/gi, // ?apikey=…
  /postgres(ql)?:\/\/[^\s"']+/gi, // any connection string
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
];

function scrubString(s: string, secrets: string[]): string {
  let out = s;
  for (const v of secrets) out = out.split(v).join("[redacted]");
  out = out.replace(PATTERNS[0], "$1=[redacted]");
  out = out.replace(PATTERNS[1], "postgres://[redacted]");
  out = out.replace(PATTERNS[2], "Bearer [redacted]");
  return out;
}

/** Walks any JSON-ish value and scrubs every string in place. Depth-limited. */
function scrubDeep(value: unknown, secrets: string[], depth = 0): unknown {
  if (depth > 8 || value == null) return value;
  if (typeof value === "string") return scrubString(value, secrets);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrubDeep(value[i], secrets, depth + 1);
    return value;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = scrubDeep(o[k], secrets, depth + 1);
    return o;
  }
  return value;
}

/** `beforeSend` for the Node/Edge runtimes: header drop (shared) + secret scrub. */
export function scrubServerEvent<E extends ErrorEvent>(event: E): E {
  const secrets = secretValues();
  scrubDeep(event.exception, secrets);
  scrubDeep(event.breadcrumbs, secrets);
  scrubDeep(event.extra, secrets);
  scrubDeep(event.contexts, secrets);
  scrubDeep(event.tags, secrets);
  if (event.message) event.message = scrubString(event.message, secrets);
  if (event.request) {
    if (event.request.url) event.request.url = scrubString(event.request.url, secrets);
    if (event.request.query_string && typeof event.request.query_string === "string") {
      event.request.query_string = scrubString(event.request.query_string, secrets);
    }
    // Never ship request bodies from the server: they can hold signatures and quotes.
    delete event.request.data;
  }
  return event;
}
