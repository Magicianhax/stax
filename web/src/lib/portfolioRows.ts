// One asset's /api/portfolio holding rows, given its on-chain balances and prices. Split out of
// the route so the twin-holding rule — a second row, its own price, its own venue tag, never
// fabricated when the balance or the price is missing — is a plain Node test instead of
// something only visible by holding both issuers of a stock and reloading the app.
import type { Asset, RwaPlatform } from "./chains";
import { fromUnits } from "./format";

export interface PortfolioHoldingRow {
  symbol: string;
  /** Raw balance as a decimal string (bigint-safe for JSON). */
  raw: string;
  qty: number;
  priceUsd: number | null;
  valueUsd: number | null;
  dayChangePct: number | null;
  spark: number[] | null;
  /** Supply APY (percent) for yield assets like aUSDC, when known. */
  apy: number | null;
  /** BSC only: which issuer minted this row's tokens (`asset.platform` for the default row,
   *  `asset.twin.platform` for a twin row). Undefined on every Base/Mantle holding — those
   *  assets carry no `platform` at all — so existing (non-BSC) output is unaffected. */
  venue?: RwaPlatform;
}

export interface BuildAssetRowsParams {
  asset: Asset;
  /** Balance at `asset.address`, raw units in `asset.decimals`. */
  defaultRaw: bigint;
  defaultPriceUsd: number | null;
  /** Balance at `asset.twin.address`, raw units in `asset.twin.decimals`. Only meaningful (and
   *  only ever produces a row) when `asset.twin` is set — an asset with no twin can't hold one,
   *  whatever a caller passes here. */
  twinRaw?: bigint;
  twinPriceUsd?: number | null;
  /** Real 1D market move — the same for both venues, since it's one underlying share. */
  dayChangePct: number | null;
  spark: number[] | null;
  apy: number | null;
}

/** One priced row for a raw balance, or undefined when there's nothing held. */
function rowFor(
  symbol: string,
  raw: bigint,
  decimals: number,
  priceUsd: number | null,
  dayChangePct: number | null,
  spark: number[] | null,
  apy: number | null,
  venue: RwaPlatform | undefined,
): PortfolioHoldingRow | undefined {
  if (raw <= BigInt(0)) return undefined;
  const qty = fromUnits(raw, decimals);
  return {
    symbol,
    raw: raw.toString(),
    qty,
    priceUsd,
    valueUsd: priceUsd !== null ? qty * priceUsd : null,
    dayChangePct,
    spark,
    apy,
    ...(venue ? { venue } : {}),
  };
}

/**
 * The holding row(s) for one asset: the default address always (when held), plus the twin's own
 * row (when the asset has a twin AND the caller passed a positive `twinRaw`) — so a user who
 * ended up holding both bStock's and Ondo's mint of the same ticker sees both, each priced and
 * labeled by its own venue rather than one hiding the other or borrowing its price.
 */
export function buildAssetRows(p: BuildAssetRowsParams): PortfolioHoldingRow[] {
  const rows: PortfolioHoldingRow[] = [];
  const byDefault = rowFor(
    p.asset.symbol,
    p.defaultRaw,
    p.asset.decimals ?? 18,
    p.defaultPriceUsd,
    p.dayChangePct,
    p.spark,
    p.apy,
    p.asset.platform,
  );
  if (byDefault) rows.push(byDefault);

  if (p.asset.twin && p.twinRaw !== undefined) {
    const byTwin = rowFor(
      p.asset.symbol,
      p.twinRaw,
      p.asset.twin.decimals,
      p.twinPriceUsd ?? null,
      p.dayChangePct,
      p.spark,
      null, // a twin row is always a tokenized stock, never a yield asset
      p.asset.twin.platform,
    );
    if (byTwin) rows.push(byTwin);
  }
  return rows;
}
