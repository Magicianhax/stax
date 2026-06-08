// Single source of truth for SEO/canonical metadata. The production site is
// served on the www host (the apex stax.best 301-redirects to www), so the
// canonical origin MUST be www to avoid duplicate-content + redirect dilution.
export const SITE_URL = "https://www.stax.best";
export const SITE_NAME = "Stax";

export const SITE_TAGLINE = "Invest in plain words";
export const SITE_DESCRIPTION =
  "Invest in real companies with Vera, your investing assistant. Email login, no seed phrase, fees on us. Tokenized stocks on Mantle, gasless.";

export const TWITTER_HANDLE = "@stax_market";

// OG/Twitter share image dimensions (Open Graph standard).
export const OG_SIZE = { width: 1200, height: 630 } as const;
