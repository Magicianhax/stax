// `/gift/<id>` — the public link a giver shares. Server-rendered so the preview
// (and its metadata) exist before any JavaScript runs, and so the recipient's
// email never reaches the browser: the page shows ONLY what the preview reader
// returns, which carries no email, no addresses and no token amounts.
//
// The reader is imported directly rather than fetched over our own route
// handler: no absolute-URL guessing, and a null we can render honestly. Both
// front doors go through `loadGiftPreview`, so they cannot disagree about what
// is safe to show.
import type { Metadata } from "next";
import { loadGiftPreview } from "@/lib/server/giftPreview";
import { demoGiftPreview } from "@/lib/demo/demoData";
import { unlockDate, isUnlocked } from "@/components/lite/gift/giftFormat";
import type { GiftPreview } from "@/components/lite/gift/types";
import { GiftSharePage } from "./GiftSharePage";

async function loadPreview(id: string): Promise<GiftPreview | null> {
  // Development only: the seeded demo gifts render without a database or a
  // chain, so the page can be built and reviewed before any gift is real.
  if (process.env.NODE_ENV !== "production") {
    const demo = demoGiftPreview(id);
    if (demo) return demo;
  }
  try {
    return await loadGiftPreview(id);
  } catch {
    return null;
  }
}

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const preview = await loadPreview(id);
  if (!preview) {
    return {
      title: "A gift on Stax",
      description: "This gift link isn't available. Ask whoever sent it to share it again.",
      robots: { index: false, follow: false },
    };
  }
  const giver = preview.fromName;
  const title = giver ? `${giver} sent you a gift` : "Someone sent you a gift";
  const when = isUnlocked(preview.unlockAt)
    ? "It's ready now."
    : `Held safely until ${unlockDate(preview.unlockAt)}.`;
  const description = `${money(preview.amountUsd)} of ${preview.basketName}, invested and waiting for you. ${when}`;
  return {
    title,
    description,
    // A gift link is personal: shareable, but never something to index.
    robots: { index: false, follow: false },
    alternates: { canonical: `/gift/${id}` },
    // The site's default share image (app/opengraph-image.png) carries here.
    openGraph: { title: `${title} · Stax`, description, url: `/gift/${id}` },
    twitter: { title: `${title} · Stax`, description },
  };
}

export default async function GiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const preview = await loadPreview(id);
  return <GiftSharePage preview={preview} />;
}
