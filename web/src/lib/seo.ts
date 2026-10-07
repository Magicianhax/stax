// Single source of truth for SEO/canonical metadata. The production site is
// served on the www host (the apex stax.best 301-redirects to www), so the
// canonical origin MUST be www to avoid duplicate-content + redirect dilution.
import { STAX_FEE_PCT } from "./fees";

export const SITE_URL = "https://www.stax.best";
export const SITE_NAME = "Stax";

export const SITE_TAGLINE = "Invest in plain words";
export const SITE_DESCRIPTION =
  "Real tokenized stocks on BNB Chain, from bStock and Ondo. Vera, an AI broker, plans from what’s open and won’t buy at a weekend premium. Email login, no seed phrase, no Stax fee.";

/**
 * The structured-data offer's description. It used to say trading fees are covered by Stax, which
 * is only true on BNB Chain; Base and Mantle charge a flat fee (lib/fees.ts), and the FAQ and the app
 * both say so. Search engines and LLM crawlers read this, so it has to match them.
 */
export const OFFER_DESCRIPTION = `No account fees. No Stax fee on BNB Chain, and network fees are covered by Stax. On Base and Mantle a flat ${STAX_FEE_PCT}% fee applies to what you invest.`;

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
  "Stocks are issued by bStock and Ondo on BNB Chain, Coinbase on Base and Backed on Mantle, for eligible non-US users.";

// OG/Twitter share image dimensions (Open Graph standard).
export const OG_SIZE = { width: 1200, height: 630 } as const;
