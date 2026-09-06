import "server-only";

// Shared baskets (Postgres). A basket saved here gets an 8-char base62 id and a
// short link `/app?b=<id>`; the encoded `?basket=` link keeps working without a
// server round-trip. See docs/INFRA.md + lib/baskets.ts.
//
//   saveBasket(basket, ownerUserId)  → id   (retries on the astronomically rare id collision)
//   getBasket(id)                    → the basket re-validated against today's registry
//                                      (risk recomputed, author "shared"), or a reason
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, baskets } from "@/lib/db";
import { BASKET_SHORT_ID_LENGTH, sharedBasketFrom, type Basket, type BasketItem, type DecodeResult } from "@/lib/baskets";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MAX_ATTEMPTS = 5;

/** Unbiased base62 id from crypto randomness (rejection-sampled bytes). */
function shortId(): string {
  let out = "";
  while (out.length < BASKET_SHORT_ID_LENGTH) {
    for (const b of randomBytes(16)) {
      // 248 = 4 * 62: bytes at or above it would skew the distribution.
      if (b < 248) out += ALPHABET[b % 62];
      if (out.length === BASKET_SHORT_ID_LENGTH) break;
    }
  }
  return out;
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "23505");
}

/** Persist a validated basket; returns its short id. `ownerUserId` must already exist in `users`. */
export async function saveBasket(basket: Basket, ownerUserId: string | null): Promise<string> {
  const items: BasketItem[] = basket.items.map((i) => ({ symbol: i.symbol, weightPct: i.weightPct }));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const id = shortId();
    try {
      await db.insert(baskets).values({
        id,
        chain: basket.chain,
        ownerUserId,
        name: basket.name,
        tagline: basket.tagline,
        icon: basket.icon,
        items,
        riskScore: basket.riskScore,
        author: basket.author,
        source: basket.source ?? null,
      });
      return id;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === MAX_ATTEMPTS - 1) throw err;
    }
  }
  throw new Error("could not allocate a basket id");
}

/** Load a stored basket by short id, re-validated so risk/weights match today's registry. Null when unknown. */
export async function getBasket(id: string): Promise<DecodeResult | null> {
  const [row] = await db.select().from(baskets).where(eq(baskets.id, id)).limit(1);
  if (!row) return null;
  const source = row.source && typeof row.source === "object" ? (row.source as { goal?: unknown }) : undefined;
  return sharedBasketFrom(
    { id: row.id, chain: row.chain, name: row.name, tagline: row.tagline, icon: row.icon, items: row.items, source },
    Math.floor(row.createdAt.getTime() / 1000),
  );
}
