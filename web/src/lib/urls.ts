// Subdomain-aware URLs. In production the product lives on subdomains
// (app.stax.best, beta.stax.best, admin.stax.best) and the marketing site on
// www.stax.best; next.config.ts rewrites each host's root to the matching route
// and redirects the old paths. Locally (env unset) everything stays path-based
// on one origin, so nothing here needs a special dev setup.
//
// Set on Vercel once DNS is live:
//   NEXT_PUBLIC_SITE_URL=https://www.stax.best
//   NEXT_PUBLIC_APP_URL=https://app.stax.best
//   NEXT_PUBLIC_BETA_URL=https://beta.stax.best
//   NEXT_PUBLIC_ADMIN_URL=https://admin.stax.best

const strip = (v?: string) => (v ? v.replace(/\/+$/, "") : "");

export const SITE_ORIGIN = strip(process.env.NEXT_PUBLIC_SITE_URL);
export const APP_ORIGIN = strip(process.env.NEXT_PUBLIC_APP_URL);
export const BETA_ORIGIN = strip(process.env.NEXT_PUBLIC_BETA_URL);
export const ADMIN_ORIGIN = strip(process.env.NEXT_PUBLIC_ADMIN_URL);

/** The app (`/app` locally, the app subdomain in production). `query` like `?b=abc`. */
export function appUrl(query = ""): string {
  return APP_ORIGIN ? `${APP_ORIGIN}/${query}` : `/app${query}`;
}

/** The beta / waitlist page. */
export function betaUrl(query = ""): string {
  return BETA_ORIGIN ? `${BETA_ORIGIN}/${query}` : `/beta${query}`;
}

/** The admin console. */
export function adminUrl(): string {
  return ADMIN_ORIGIN ? `${ADMIN_ORIGIN}/` : "/admin/beta";
}

/** A marketing-site path (`/demo`, `/#faq`). Absolute only when the site origin is known. */
export function siteUrl(path = "/"): string {
  return SITE_ORIGIN ? `${SITE_ORIGIN}${path}` : path;
}

/** Absolute app URL for links that leave the page (share sheets, clipboard). */
export function absoluteAppUrl(query = ""): string {
  if (APP_ORIGIN) return `${APP_ORIGIN}/${query}`;
  const origin = typeof window !== "undefined" ? window.location.origin : SITE_ORIGIN || "https://www.stax.best";
  return `${origin}/app${query}`;
}

/**
 * Absolute marketing-site URL for links handed to someone who isn't here yet (a gift
 * share link, an email). Unlike `siteUrl` this never returns a bare path, because a
 * relative link pasted into a message goes nowhere.
 */
export function absoluteSiteUrl(path = "/"): string {
  if (SITE_ORIGIN) return `${SITE_ORIGIN}${path}`;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://www.stax.best";
  return `${origin}${path}`;
}
