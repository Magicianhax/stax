// Single source of truth for SEO/canonical metadata. The production site is
// served on the www host (the apex stax.best 301-redirects to www), so the
// canonical origin MUST be www to avoid duplicate-content + redirect dilution.
export const SITE_URL = "https://www.stax.best";
export const SITE_NAME = "Stax";

export const SITE_TAGLINE = "Invest in plain words";
export const SITE_DESCRIPTION =
  "Own real companies in plain words. Vera, an AI broker, builds the plan and a contract on Base checks it before money moves. Tokenized stocks, email login, no seed phrase. For eligible non-US users.";

export const TWITTER_HANDLE = "@stax_market";
export const GITHUB_URL = "https://github.com/Magicianhax/stax";

/** Third-party awards, verbatim from the organiser's announcements (July 10, 2026, @Mantle_Official). */
export const AWARDS = [
  {
    name: "Track Winner, Trading & Strategy",
    event: "Mantle Turing Test Hackathon 2026",
    date: "2026-07-10",
    url: "https://x.com/Mantle_Official/status/2075596029408514552",
  },
  {
    name: "Best UI/UX",
    event: "Mantle Turing Test Hackathon 2026",
    date: "2026-07-10",
    url: "https://x.com/Mantle_Official/status/2075596047746027814",
  },
] as const;

/** Eligibility, in the words used on the site. */
export const ELIGIBILITY =
  "Stocks are issued by Coinbase on Base and Backed on Mantle for eligible non-US users.";

// OG/Twitter share image dimensions (Open Graph standard).
export const OG_SIZE = { width: 1200, height: 630 } as const;
