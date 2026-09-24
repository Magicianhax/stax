# Binance Web3 API: integration reference for Stax on BSC

The reference build agents code against for the BNB Hack. It comes from four live research passes
run on 2026-09-24 between 12:05 and 12:30 UTC, using the Stax Web3 API key (HMAC), and from the
official connector SDKs.

Labels used below:

- **LIVE**: a signed call was made and the response is described as it came back.
- **DOCS**: quoted from Binance docs or SDK source, not exercised.
- **UNVERIFIED**: inferred, guessed, or contradicted between passes. Check it before relying on it.

No transaction was signed or broadcast during research. Everything past "build unsigned calldata"
is DOCS or UNVERIFIED.

---

## 1. Base URL, auth, signing

| | |
|---|---|
| REST base | `https://web3.binance.com/build` (LIVE) |
| WebSocket | `wss://web3-stream.binance.com/w3w`; token from `GET /api/v1/dex/market/wss/auth/token` (DOCS) |
| Credentials | `WEB3_API_KEY`, `WEB3_SECRET_KEY` (HMAC pair). They sit in `stax/local.env` on the builder machine. Server-only: never `NEXT_PUBLIC_`, never logged. |

### Headers (LIVE)

| Header | Required | Value |
|---|---|---|
| `X-OC-APIKEY` | yes | API key, plaintext |
| `X-OC-TIMESTAMP` | yes | `new Date().toISOString()`, ISO-8601 UTC with milliseconds (`2026-09-24T12:26:37.000Z`) |
| `X-OC-SIGN` | yes | `base64(HMAC-SHA256(secret, preHash))` |
| `X-OC-RECV-WINDOW` | no | ms of clock-skew tolerance. Docs give a default of 5000 and a max of 60000; the Python SDK defaults to 15000. **Always send it explicitly** (the research client sent 60000). |
| `X-OC-NONCE` | no | anti-replay id (DOCS, not exercised) |
| `Content-Type` | yes | `application/json` |

### Pre-hash (LIVE, GET and POST)

```
preHash = timestamp + METHOD + requestPath + body
```

- `timestamp`: the exact string sent in `X-OC-TIMESTAMP`.
- `METHOD`: uppercase.
- `requestPath`: **includes the `/build` prefix**, then the path, then `?` and the query string
  exactly as it goes on the wire. Example:
  `/build/api/v1/dex/aggregator/quote?binanceChainId=56&fromTokenAddress=0x…`. Leaving out `/build`
  is the documented top cause of `40102`.
- `body`: the exact JSON string sent for POST. Empty string for GET.
- No separators. UTF-8.

Proven failure: signing with the wrong secret returns **HTTP 401**
`{"code":40102,"msg":"Invalid signature","data":""}` (LIVE). This is the only failure seen with a
non-200 status.

The Python SDK builds the query with keys in camelCase, in insertion order, `+` for a space (LIVE
through a JS port). Any encoding works as long as **the signed string equals the sent string
byte for byte**. Build the query string once and use it for both.

Ed25519 or RSA keys are supported with the same pre-hash (DOCS). Not needed: our key pair is HMAC.

### Minimal signing client (reconstructed from the live-proven scripts)

```ts
// server-only
import { createHmac } from "node:crypto";

const ORIGIN = "https://web3.binance.com";
const PREFIX = "/build";

export class BinanceWeb3Error extends Error {
  constructor(public code: number, msg: string, public httpStatus: number) {
    super(`Binance Web3 ${code}: ${msg}`);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

export async function web3Request<T>(
  method: "GET" | "POST",
  path: string, // "/api/v1/dex/market/rwa/tokens"
  query: Query = {},
  body?: unknown,
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.append(k, String(v));
  const q = qs.toString();
  const requestPath = `${PREFIX}${path}${q ? `?${q}` : ""}`;
  const bodyStr = body === undefined ? "" : JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const sign = createHmac("sha256", process.env.WEB3_SECRET_KEY!)
    .update(timestamp + method + requestPath + bodyStr, "utf8")
    .digest("base64");

  const res = await fetch(ORIGIN + requestPath, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-OC-APIKEY": process.env.WEB3_API_KEY!,
      "X-OC-TIMESTAMP": timestamp,
      "X-OC-SIGN": sign,
      "X-OC-RECV-WINDOW": "60000",
    },
    body: bodyStr || undefined,
  });
  const json = (await res.json()) as { code: number; msg: string; data: T; success?: boolean };
  // Business errors arrive as HTTP 200 with code != 0. Never branch on res.ok alone.
  if (json.code !== 0) throw new BinanceWeb3Error(json.code, json.msg, res.status);
  return json.data;
}
```

### Response envelope (LIVE, every call)

```json
{ "code": 0, "msg": "success", "data": <payload>, "timestamp": 1790252737733, "success": true }
```

Business failures return **HTTP 200** with `code != 0` and `success: false`. Check `code`, not
the HTTP status.

### Rate limits

LIVE, on `GET /aggregator/supported/chain` with our key: response headers
`X-OC-RateLimit-Limit: 5`, `X-OC-RateLimit-Remaining: 4`, `X-OC-Used-Weight: 1`,
`X-OC-Server-Time`, `X-OC-Trace-Id`. The window length is **UNVERIFIED**, and so is whether the
limit is per endpoint or per key. The over-limit response is also UNVERIFIED: the SDK maps
`429` to TooManyRequests and `418` to RateLimitBan (DOCS). Treat 5 per window as the budget.
Cache every read server-side, serialise calls, and read `X-OC-RateLimit-Remaining`.

### Error codes

| Code | Meaning | Source |
|---|---|---|
| `40001` | Parameter error; the message names the parameter (`"Parameter [binanceChainId] is required"`). For a bad POST body the message is generic: `"Invalid request body: malformed JSON or field type mismatch"`. | LIVE |
| `40102` | Invalid signature (HTTP 401) | LIVE |
| `40375` | `"Minimum order amount is 5 USD."` | LIVE |
| `40381` | `"No valid RWA tokens found in the provided addresses"`. Returned for both a bad chain id and a bad address. | LIVE |
| `40411` | `"This chain is not supported"` | LIVE |
| `50000` | Upstream timeout. The message leaks internal hostnames. | LIVE |
| `40401` QUOTE_EXPIRED, `40462` SWAP_QUOTE_MISMATCH, `40466` INVALID_FEE_PERCENT, `40467` INVALID_REFERRER_ADDRESS, `40468` CONFLICT_REFERRER_PARAMS, `40469` REFERRER_NOT_ACTIVATED | as named | DOCS |

No full error-code table could be fetched. Every guessed docs URL for one came back empty.

### Chain ids

A string field named **`binanceChainId`** everywhere except `rwa/tokens`, where a stray `chainId=56`
also worked (UNVERIFIED whether it was honoured or ignored; use `binanceChainId`). BSC = `"56"`.
EVM chains use the decimal chain id as a string. Non-EVM chains use `CT_<n>` (Solana `CT_501`,
Tron `CT_195`).

**Each module has its own chain list and the lists disagree** (LIVE). Portfolio lists `"4663"`
Robinhood, which the balance list lacks. BSC is named "BNB Smart Chain" in one list and "BNB Chain"
in another. Two passes minutes apart got different `aggregator/supported/chain` results, one with
Solana and one without. BSC (`56`) was present in every list. Never assume a chain id valid for one
module is valid for another.

---

## 2. RWA Data (tokenized stocks), prefix `/api/v1/dex/market/rwa`

All GET, all signed.

| Endpoint | Required | Optional | Status |
|---|---|---|---|
| `/platforms` | none | `platformId` | LIVE |
| `/tokens` | none | `binanceChainId`, `platformId` (`ondo`\|`bstock`), `tabId` | LIVE |
| `/price` | `binanceChainId`, `tokenContractAddresses` (comma-separated, max 100) | none | LIVE |
| `/search` | `keyword` (ticker, company or address; case-insensitive) | `platformId` | LIVE |
| `/underlying-profile` | `binanceChainId`, `tokenContractAddress` | none | LIVE |
| `/underlying-market` | `binanceChainId`, `tokenContractAddress` | none | LIVE |

### `/platforms` (LIVE)

`[{ platformId, tickerCount, chainDistribution: [{ binanceChainId, tokenCount }], website, logoUrl }]`.
Exactly two platforms exist:

- `ondo`: 459 tickers on chains 1, 56 and CT_501. Reports 458 tokens on chain 56.
- `bstock`: 80 tickers, chain 56 only.

**xStocks is not in this API.** It does not appear in `/platforms` or in a keyword scan of all 488
BSC rows, although the Agentic Wallet `SKILL.md` names it as provider `type=2`. Do not build an
xStocks branch against this API.

**`/platforms` counts do not match `/tokens`** (LIVE). At the same moment `/tokens?binanceChainId=56`
returned 442 ondo rows and 46 bstock rows, against 458 and 80 above. One case is proven:
`/search?keyword=AAPL` returns **AAPLB** (bstock,
`0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a`), and that address is **not** in the `/tokens` list.
Use `/tokens` for what is listed. A token found only through `/search` is real but may be
unlisted; check it with `/price` and a quote before offering it.

### `/tokens` row (LIVE, chain 56, n=488)

```ts
{
  binanceChainId: "56";
  tokenContractAddress: string;       // lowercase
  platformId: "ondo" | "bstock";
  assetType: 1 | 3 | null;            // 1 = stock, 3 = ETF (incl. leveraged/inverse); 2 = pre-IPO per docs, not seen; null on 3 rows
  tokenName: string;                  // "AAON (Ondo Tokenized)"
  tokenSymbol: string;                // ondo: "<TICKER>on", bstock: "<TICKER>B"
  tokenLogoUrl: string;
  decimals: "18";                     // a string; every BSC row is "18"
  underlyingTicker: string;
  underlyingName: string;
  underlyingNameZh: string;
  tokenToShareRatio: string;          // e.g. "1.000898203596656132" tokens per share
  tags: string[] | null;              // null on every row in this pull
  statusInfo: {
    openState: boolean;
    marketStatus: "premarket" | "regular" | "postmarket" | "overnight" | "closed" | "paused" | null;
    reasonCode: "TRADING" | "MARKET_CLOSED" | "MARKET_PAUSED" | "MARKET_MAINTENANCE" | "ASSET_PAUSED" | "ASSET_LIMITED" | "UNSUPPORTED";
    reasonMsg: string | null;
    nextOpenTime: number | null;      // epoch ms
    nextCloseTime: number | null;     // epoch ms
  };
  tokenPrice: string;                 // on-chain USD, up to ~34 significant digits for ondo
  referencePrice: string;             // underlying USD
  volume24H: string;
  marketCap: string;
  peRatioTTM: string;
}
```

Status distribution at 12:28 UTC, during the US premarket (LIVE, from the saved dump):

| platform | marketStatus | reasonCode | openState | rows |
|---|---|---|---|---|
| ondo | `premarket` | `TRADING` | true | 349 |
| ondo | `premarket` | `UNSUPPORTED` | false | 51 |
| ondo | `paused` | `MARKET_PAUSED` | false | 42 |
| bstock | `null` | `TRADING` | true | 46 |

The enum values above that were not observed come from DOCS (`regular`, `postmarket`, `overnight`,
`closed`, `MARKET_CLOSED`, `MARKET_MAINTENANCE`, `ASSET_PAUSED`, `ASSET_LIMITED`). Docs spell the
pause status `pause`; the live value is `paused`. Accept both.

Market-status rules:

- **ondo**: `marketStatus`, `nextOpenTime` and `nextCloseTime` are populated. During premarket,
  `nextCloseTime` (13:29:00Z) came *before* `nextOpenTime` (13:31:00Z). Treat `nextCloseTime` as
  unreliable while the status is `premarket`.
- **bstock**: `marketStatus`, `nextOpenTime` and `nextCloseTime` are always `null`, in both `/tokens`
  and `/underlying-market`. Only `openState` and `reasonCode` can be used. For open, closed or
  "opens at" copy on bstock rows, fall back to Stax's own US-market calendar
  (`web/src/lib/marketHours.ts`).
- Offer a buy only when `openState === true && reasonCode === "TRADING"`.

**`tabId` (sector filter) does nothing** (LIVE). `tabId` 9, 4, 11 and 13, and the invalid 999, all
returned the identical unfiltered 488 rows with `code: 0`. Docs list 1–13 (1 Serenity Call,
2 SpaceX, 3 Upcoming Earnings, 4 AI Chips, 5 Storage, 6 Energy, 7 Precious Metals, 8 China ADR,
9 Magnificent 7, 10 Crypto, 11 ETF, 12 Tech Leaders, 13 Buffett Portfolio). No row carries a
sector field, so do any grouping with Stax's own ticker lists. `platformId` does filter correctly
(bstock: 46 of 488).

### `/price` (LIVE)

`[{ binanceChainId, tokenContractAddress, platformId, tokenPrice, referencePrice, tokenPriceUpdatedAt /* epoch ms */ }]`.
This is the reliable reference-price source for bstock rows (see `/underlying-market` below).

### `/search` (LIVE)

`[{ ticker, companyName, assets: [{ platformId, binanceChainId, tokenContractAddress, tokenSymbol, assetType }] }]`.
`NVDA` returns 4 assets: ondo on 1, 56 and CT_501, plus bstock on 56. Missing `keyword` returns `40001`.

### `/underlying-profile` (LIVE)

`{ binanceChainId, tokenContractAddress, platformId, underlyingTicker, underlyingFullName, assetType, tokenToShareRatio, protections, companyInfo: { ceo, website, industry, conceptsEn, conceptsCn, description, descriptionZh } }`.

`protections` is keyed by report type, each `{ supported, description, url }`:

- ondo: `dailyAttestationReport` and `monthlyAttestationReport`, with PDF URLs.
- bstock: `collateralReport`, with `url: null` in the NVDA sample and `supported: true` for AAPLB.

### `/underlying-market` (LIVE)

`{ statusInfo, marketData: { referencePrice, high52W, low52W, volumeShares24H, avgDailyVolume1Y, totalShares, marketCap, turnoverRate, amplitude, peRatioTTM, pbRatio, dividendYield, latestDividend } }`.
Fields are nullable. For bstock NVDA, `marketData.referencePrice` was `null` although `/price`
returned one. Use `/price` for bstock reference prices.

### On-chain vs reference price gap (LIVE, 12:28–12:29 UTC, premarket)

| Ticker | Platform | On-chain | Reference | Gap |
|---|---|---|---|---|
| NVDA | ondo | 224.116859 | 223.733101 | +0.172% |
| NVDA | bstock | 223.543832 | 223.37 | +0.078% |
| TSLA | ondo | 376.53 | 376.53 | 0% |
| TSLA | bstock | 376.63 | 376.63 | 0% |
| MSFT | ondo | 502.904979 | 500.039325 | +0.573% |
| MSFT | bstock | 498.404026 | 497.75 | +0.131% |
| META | ondo | 735.707713 | 733.633791 | +0.283% |
| META | bstock | 731.710970 | 731.31 | +0.055% |
| AAPL | ondo | 339.022030 | 337.881318 | +0.338% |
| AAPL | bstock (AAPLB) | 336.78 | 336.576739 | +0.060% |

In this one snapshot, ondo on-chain prices carried a small premium over their own reference, and
bstock tracked its reference more tightly. A single premarket sample, not a pattern.

---

## 3. Market API (general), prefix `/api/v1/dex/market`

| Endpoint | Status | Notes |
|---|---|---|
| `GET /supported/chain` | DOCS | |
| `GET /candles` | LIVE | `binanceChainId`, `tokenContractAddress`, `bar`, `limit`, `after`/`before` (epoch ms, exclusive) |
| `GET /token/search` | LIVE (error only) | **requires `chains`**. `keyword` alone returns `40001 "Parameter chains is required"`. Full parameter list UNVERIFIED. |
| `POST /price`, `POST /price-info` (batch, 100 or fewer) | UNVERIFIED | |
| `/token/basic-info`, `/token/advanced-info`, `/token/hot-token`, `/token/holder`, `/token/top-trader`, `/token/top-liquidity`, `/trades` | UNVERIFIED | from a docs summary only |
| Portfolio: see §6 | | |

`bar` values (DOCS; only `1h` exercised): `1s 5s 30s 1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M`.

**Candle row (LIVE):** `[open, high, low, close, volume, timestampMs, tradeCount]`. The timestamp is
at **index 5**, not index 0 as on Binance spot klines. The docs say values are strings; a LIVE call
(2026-09-24, NVDAB, bar=1h) returned plain JSON numbers, so accept both. Parse by position with
that order.

---

## 4. Trading API (DEX aggregator), prefix `/api/v1/dex/aggregator`

**What it is:** an on-chain DEX aggregator. It returns **unsigned EVM calldata** for a router
contract, the same shape as KyberSwap's build step. It is not a CEX order book. This settles the
integration map's open question: its output can feed a `StaxExecutor` `Leg`, as long as the
route's mode is `SWAP` (see RFQ below).

### `GET /supported/chain` (LIVE)

`[{ binanceChainId, name, shortName, … }]`, includes `56`.

### `GET /quote` (LIVE)

| Param | Required | Notes |
|---|---|---|
| `binanceChainId` | yes | **not `chainId`**; sending `chainId` returns `40001` |
| `fromTokenAddress`, `toTokenAddress` | yes | |
| `amount` | yes | smallest units, as a string (`value × 10^decimals`) |
| `userWalletAddress` | conditionally | Required whenever the pair *could* route through Ondo RFQ: `40001 "userWalletAddress is required for RFQ (Ondo) quote"`. **Always send it.** For executor legs, send the executor address (it is the account that calls the router). |
| `slippagePercent` or `autoSlippage` + `maxAutoSlippagePercent` | no | |
| `priceImpactProtectionPercent` | no | default 90 (DOCS) |
| `vendor` | no | single-vendor filter (`LiquidMesh`, `Pancake`, …) |
| `feePercent` + `feeSource` | no | **must be sent together** (LIVE, undocumented). `feeSource` = `FROM_TOKEN` (LIVE) or `TO_TOKEN` (DOCS). Range 0–5 on EVM (DOCS). |
| `fromTokenReferrerWalletAddress` or `toTokenReferrerWalletAddress` | with fee | the fee recipient; the two are mutually exclusive (DOCS). Only the `from` variant was tested. |
| `enableRfq` | no | appears on `quote-and-swap` in the SDK. Whether `/quote` and `/swap` honour it is UNVERIFIED. |

**Minimum order: exactly $5.00 fails** (`40375`) and $6.00 succeeds. Treat the minimum as
**more than $5**. This applies **per quote, so per basket leg**.

Response `data` is an array of routes (LIVE: one route each time):

```ts
{
  quoteId: string;                 // feeds /swap; fetch fresh immediately before /swap (TTL UNVERIFIED)
  vendorName: string;              // "LiquidMesh" in every live route
  executionMode: "SWAP" | "RFQ";   // only SWAP ever returned live
  binanceChainId: string;
  fromTokenAmount: string; toTokenAmount: string;  // smallest units
  tradeFee: string;                // "0.02637385" for $6 (units UNVERIFIED, looks like USD)
  estimateGasFee: string;          // "450000", looks like gas units, not a fee (UNVERIFIED)
  priceImpactPercent: string;
  router: string;                  // hop path joined by "--"
  fromToken: { tokenContractAddress; tokenSymbol; tokenUnitPrice; decimal /* string */; isHoneyPot; taxRate };
  toToken:   { …same };
  dexRouterList: { dexProtocol: { dexName; percent }; fromToken; fromTokenIndex; toToken; toTokenIndex }[];
  approveTarget: string;           // ERC-20 spender
  isBest: boolean;
  feeAmount?: string; feeToken?: string; actualSwapAmount?: string; // only with fee params
}
```

Sample route: $6 USDT to AAPLon gave `toTokenAmount 17746966277828301` (about 0.0177 AAPLon),
priced 1:1 USDT. With `feePercent=1&feeSource=FROM_TOKEN`: `feeAmount 60000000000000000` (exactly
1% of 6e18), `feeToken` = USDT, `actualSwapAmount 5940000000000000000`. The route became 4 hops
(Topaz, Neptunex, PancakeV3, UniswapV3). Whether the fee params caused that change is UNVERIFIED.

**Router / spender (LIVE, the same in quote, approve and swap):
`0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5`.** It is the only address the executor would whitelist
for Binance legs. Assert that `approveTarget` and `tx.to` equal it on every call, as `kyber.ts` does
with `assertWhitelistedRouter`.

### `GET /swap` (LIVE, unsigned calldata)

The params are the same as `/quote`, plus a **required `quoteId`** from a fresh `/quote` (`40001` if
missing), and `slippagePercent`.

```ts
{
  executionMode: "SWAP" | "RFQ";
  routerResult: /* same shape as a quote route */;
  tx: {
    from: string; to: string /* router, == approveTarget */; data: string /* hex */;
    value: string /* wei, "0" for token→token */; gas: string /* "450000" */;
    gasPrice: string; maxPriorityFeePerGas: string;
    minReceiveAmount: string; slippagePercent: string;
    signatureData: null; computeUnitPrice: null; computeUnitLimit: null; // Solana-only
  };
  rfq: null | unknown;             // populated only in RFQ mode; shape UNVERIFIED
}
```

RESOLVED in §10 (LIVE-calldata, 2026-09-24), with one caveat recorded there. Originally open and
critical for executor legs: whether the calldata delivers output to `msg.sender`, to
`userWalletAddress`, or to `tx.from`. It was built with a dummy taker (`0x…dEaD`) and never run. Before
wiring executor legs, verify it once with `POST /pre-transaction/simulate`, using
`from = executor, to = router, data = tx.data`, and read `balanceChanges`.

### `GET /approve-transaction` (LIVE)

Params: `binanceChainId`, `tokenContractAddress`, `approveAmount`, `userWalletAddress`.
Response: `[{ data /* approve() calldata, 0x095ea7b3… */, dexContractAddress /* == approveTarget */, gasLimit /* "70000" */, gasPrice }]`.
The executor does its own `forceApprove`, so Stax only needs this for direct smart-account swaps.

### RFQ mode (DOCS only)

`POST /order/submit` takes `requestId, userSignature, vendor, quoteId, signingScheme`, and
`GET /order/{orderId}` polls it. The user must sign an EIP-712 order. **A contract (the executor)
cannot produce that signature**, and ERC-1271 support is UNVERIFIED. For executor legs, reject any
route whose `executionMode !== "SWAP"` and retry with different params (`enableRfq=false` if it is
honoured, or a `vendor` filter).

### Other (DOCS)

- `GET /quote-and-swap`: a one-shot build with extra params (`excludeDexes, enableRfq,
  approveTransaction, gasLevel, …`). Not called.
- `GET /history?binanceChainId&txHash`: swap status. Not called.
- MEV: nothing on EVM in the aggregator. EVM MEV protection is `enableMevProtection` on broadcast
  (§5).
- No limit-order REST endpoint exists. Limit orders exist only in the Agentic Wallet CLI (§8).

---

## 5. Transaction API, prefix `/api/v1/dex`

| Endpoint | Status | Notes |
|---|---|---|
| `GET /pre-transaction/supported/chain` | LIVE | 14 chains, incl. 56 ("BNB Smart Chain"), opBNB 204 |
| `GET /pre-transaction/gas-price?binanceChainId=56` | LIVE | `{ evmLegacyGasPrice: { lowGasPrice, mediumGasPrice, highGasPrice } /* wei strings */, eip1559GasPrice: null /* on BSC */, solanaGasPrice: null }`. Chain 999999 returns `40411`. |
| `POST /pre-transaction/gas-limit` | DOCS | body `{ binanceChainId, evmTx: { from, to, value, data } }` returns `{ gasLimit, …Tron-only nulls }` |
| `GET /pre-transaction/block-height` | DOCS | |
| `POST /pre-transaction/simulate` | **LIVE** | see below |
| `POST /pre-transaction/broadcast-transaction` | DOCS, never called | `{ binanceChainId, signedTransaction /* hex on EVM */, address, enableMevProtection?: boolean /* EVM only */ }` returns `{ orderId, txHash }` |
| `GET /post-transaction/orders` | DOCS | `address, binanceChainId, txStatus, orderId, cursor, limit` returns `{ cursor, orders: [{ orderId, binanceChainId, address, txHash /* null while pending */, txStatus, failReason }] }` |

### `POST /pre-transaction/simulate` (LIVE)

Request (unsigned tx; no nonce, gas or signature):

```json
{ "binanceChainId": "56", "evmTx": { "from": "0x…", "to": "0x…", "value": "0", "data": "0x…" } }
```

Response `data`:

```ts
{
  status: "SUCCESS" | string;   // other values UNVERIFIED
  failReason: string;           // "" on success; the revert reason otherwise
  balanceChanges: { contractAddress; tokenType; change; owner }[];
  allowanceChanges: { tokenAddress; owner; spender; preAmount; postAmount }[]; // addresses lowercased
}
```

It **works from an address with zero BNB** (LIVE: identical `SUCCESS` from `0x1111…1111` and from a
funded address). So it can pre-flight a brand-new smart account. It is a point-in-time check with no
block pin, so state can change before the real send. An empty body returns the generic `40001`
body error.

Stax sends through ERC-4337 (Pimlico). It does not use `broadcast-transaction`, which takes an
EOA-signed raw tx.

### Wave 5 dry-run design (LIVE, 2026-09-24 18:32–18:33 UTC, 5 calls, key `WEB3_API_KEY`)

A review of the first version of this design demanded live evidence rather than a design
reasoned from the request schema alone, so three questions were checked live with
`scratchpad/bnb/dryrun-simulate-probe.mjs` + `dryrun-probe4-nocode-simple.mjs` (session
scratchpad, not committed; every call read-only, no key value printed, no tx signed). Verbatim
responses (addresses/timestamps trimmed):

1. **Does `simulate` accept a list/bundle of `evmTx`?** POST with `evmTx` as a 2-element array:
   `{"code":40001,"msg":"Invalid request body: malformed JSON or field type mismatch"}` (200,
   1214ms). **No** — confirmed live, not just inferred from the documented single-object shape.
2. **Does it accept a state-override field?** POST with a normal single `evmTx` plus a sibling
   `stateOverride` key: `{"code":40001,"msg":"Parameter error"}` (200, 631ms). **No** — an extra
   top-level field is rejected outright, not silently ignored, so there is no way to pre-fund or
   pre-approve an account inside the simulation.
3. **What happens when `to` has no deployed bytecode?** This is the load-bearing question for
   the design below (an `executeBatch` call targets the user's *smart account*, which may not
   be deployed yet). Two calls isolate it: the exact same well-formed `approve(...)` calldata,
   byte-for-byte, sent once with `to` = a plain address with no code
   (`0x1111111111111111111111111111111111111111`) and once with `to` = the real, deployed USDT
   contract. No-code `to`: `{"code":40001,"msg":"Parameter error"}` (both the naive single-call
   version and an `executeBatch`-wrapped version of it — same code, so this isn't specific to
   the batch encoding). Real contract `to`: `{"code":0,"data":{"status":"SUCCESS","failReason":
   "","balanceChanges":[],"allowanceChanges":[{"tokenAddress":"0x55d398…97955","owner":"0x1111…
   1111","spender":"0xb44446…5fdda5","preAmount":"0","postAmount":"1000000000000000000"}]}}`
   (200, ~1.2s). **Binance's simulator refuses a no-code `to` outright** — a clean, distinguishable
   `40001` "Parameter error", never a misleading `SUCCESS` with empty effects. This is *better*
   than the failure mode the design below originally guarded against (a false-positive
   "checked" for an address that can't really be called yet); it still needs the same guard,
   because checking `getCode` locally first is free and specific, while letting Binance reject
   it spends a shared budget call to relearn something already knowable on-chain.

**The design** (`lib/server/dryRun.ts`, `encodeSimpleAccountExecuteBatch`): the deeper problem
this wave's review found is that simulating the swap *alone* almost never proves anything —
every BSC approval Stax sends is exact-amount and single-use (`directCallsForLeg`, `useSwap`'s
`aggregatorCalls`), so the account's on-chain allowance to the router is back to zero right
after every trade, not just the first. The fix is to simulate the *whole* thing the user signs
— `executeBatch([approve, swap])` — as one call `{ from: entryPoint07Address, to: <smart
account>, data: <executeBatch calldata> }`. This mirrors ERC-4337 exactly:
`EntryPoint.innerHandleOp` calls the account directly with the batch calldata, so from the
account's point of view `msg.sender == the EntryPoint`, identical to a real send. The approve
and the swap then run atomically inside that one simulated call, so this works regardless of
the account's *current* allowance — first trade of a token or the hundredth — fixing the actual
bug the review found (the old design skipped almost every real trade, and its skip reason ("first
trade of this token") was false on repeat trades of the same token).

The one genuine limit, confirmed by probe 3 above: an account that hasn't sent its first
on-chain trade yet has no deployed bytecode, and Binance cannot (and — probe 2 confirms — has no
override mechanism to) simulate a call to it. `dryRunBscSwap` calls `serverClient(chain).getCode`
first (a free RPC read) and skips with an honest reason ("this check turns on after your
wallet's very first trade sets it up on-chain") rather than spending a Binance call on a
guaranteed rejection. **Not independently verified live**, because no BSC smart account has
been deployed by Stax yet (see "Current state" in `AGENTS.md`): the exact `SUCCESS` response
shape for a real deployed account's `executeBatch(approve, swap)` — in particular whether
`balanceChanges` is populated the same way probe 3's non-batch `allowanceChanges` was. The
existing `__fixtures__/simulate_response.json` (a real router's plain `approve`, empty
`balanceChanges`) and `dryRunBscSwap`'s defensive read of `balanceChanges` (matches the taker's
own row, takes the magnitude of `change` regardless of sign) are the same posture as before this
wave: correct by construction against the documented shape, unverified against a real swap's
`balanceChanges` sign/casing until the first funded, deployed-account trade (§10 point 1) confirms
it. That first trade is also the one that will show whether an `executeBatch`-wrapped swap's
`balanceChanges` differ at all from a bare swap's.

---

## 6. Wallet API and Address Portfolio, prefix `/api/v1/dex`

| Endpoint | Status | Params | Response |
|---|---|---|---|
| `GET /balance/supported/chain` | LIVE | `binanceChainId?` | `[{ binanceChainId, name, shortName, logoUrl }]`, 10 chains, no Tron |
| `GET /balance/all-token-balances-by-address` | LIVE | `address`, `chains` (comma-joined string, `"56"`), `excludeRiskToken` (**`"false"` accepted here**), `page`, `pageSize` | `data[0] = { page, pageSize, tokenAssets: TokenAsset[] }` |
| `POST /balance/token-balances-by-address` | LIVE | body below | `data[0] = { tokenAssets: TokenAsset[] }` |
| `GET /post-transaction/transactions-by-address` | LIVE, **failed** | `address, chains, tokenContractAddress, begin, end, cursor, limit` | `50000` after 4.2 s on a busy address. Not reliable. |
| `GET /post-transaction/transaction-detail-by-txhash` | DOCS | `binanceChainId, txHash, itype` | |
| `GET /market/portfolio/supported/chain` | LIVE | none | adds `caseSensitive, nativeTokenSymbol, nativeTokenDecimals`; includes `4663` Robinhood |
| `GET /market/portfolio/overview` | LIVE | `binanceChainId, walletAddress, timeFrame` (1 = 1D, 2 = 7D, 3 = 1M, 4 = 3M) | `{ realizedPnlUsd, realizedPnlPercent, dailyPnl: [{ date, pnlUsd }], winRate, tokenCountByPnlPercent: {…}, buyTxCount, sellTxCount, totalTokenCount, buyTxVolume, sellTxVolume, avgBuyValueUsd, top3PnlTokenSumUsd, top3PnlTokenPercent, topPnlTokenList }` |
| `GET /market/portfolio/dex-history` | LIVE | `binanceChainId, walletAddress, begin, end, tokenContractAddress, type, cursor, limit` | `{ cursor, transactionList }` (empty for the router tested) |
| `GET /market/portfolio/recent-pnl`, `/token/latest-pnl` | DOCS | | |

POST balances body (LIVE). The two flatter shapes tried first both failed with the generic `40001`:

```json
{
  "address": "0x…",
  "tokenContractAddresses": [{ "binanceChainId": "56", "tokenContractAddress": "0x…" }],
  "excludeRiskToken": "0"
}
```

It takes at most 20 items. `excludeRiskToken` here is `"0"` or `"1"`, not `"true"` or `"false"`.

```ts
type TokenAsset = {
  binanceChainId: string; tokenContractAddress: string; address: string; symbol: string;
  balance: string;      // human decimal
  rawBalance: string;   // integer, base units
  tokenPrice: string;   // USD; "" when unknown
  isRiskToken: boolean; // a scam/risk flag, not an asset class
};
```

**No balance or portfolio endpoint flags a token as RWA or tokenized stock.** Classify holdings by
joining on `/rwa/tokens` addresses.

Whether portfolio PnL works for an ERC-4337 smart-account address with activity is UNVERIFIED: the
only address tested was a router contract, and every metric came back zero.

---

## 7. BSC tokenized-stock universe

Source: `GET /rwa/tokens?binanceChainId=56` at 12:28 UTC on 2026-09-24. **488 rows: ondo 442,
bstock 46. Every row has `decimals: "18"`**, ERC-20 (BEP-20). Status is `reasonCode`, with
"(closed)" when `openState` is false. This is a snapshot: fetch live and cache it. Do not hardcode
beyond a curated allowlist.

Magnificent 7 coverage: AAPL and AMZN are ondo-only in `/tokens`, though AAPLB exists through
`/search`. MSFT, NVDA, GOOGL, META and TSLA are on both platforms. All seven were `TRADING`.

### 7.1 Tickers on both platforms (40)

The "best venue" set: the same share from two issuers, so Stax can quote both and pick.

| Ticker | Type | Ondo symbol | Ondo address | Ondo status | bStock symbol | bStock address |
|---|---|---|---|---|---|---|
| AAOI | stock | AAOIon | `0x149bda9e7251dc36f536d1fe7f92a5ea203f4f3d` | TRADING | AAOIB | `0x10343ef7da3301493d7ecb647d68a288c6c1db2f` |
| AMD | stock | AMDon | `0x9f16e46c73b43bdb70861247d537bee4ea18f639` | TRADING | AMDB | `0x75fd4cf6f8392e41e70391d60c90c0d5211603a1` |
| ARM | stock | ARMon | `0x527c6436e1eaa4f2065cde4090f798cb5d031dd6` | TRADING | ARMB | `0xd42a79ebb7f527f40faecd196ffb47ad5e8d6f8c` |
| AVGO | stock | AVGOon | `0x0ed2e3180edf393e6bf8db124bd15ddd54de150a` | TRADING | AVGOB | `0x76682c454467b3a1150ad8b6a92fc5ee2c21d7ed` |
| AXTI | stock | AXTIon | `0x0c50323af81d5c33822c6add256fb9093d42bc74` | TRADING | AXTIB | `0x9bdc8b470dbf89dbcb123587c6f5e49cca3463be` |
| BABA | stock | BABAon | `0xd5964f3fcee8d649995ab88f04b8982539c282d2` | TRADING | BABAB | `0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec` |
| CBRS | stock | CBRSon | `0x441a4d4fc23f17f4cf23e3d60f12d2bd6f176728` | TRADING | CBRSB | `0xe81c6bb0266cd68b4f17278531dd03ea1f12da4e` |
| COIN | stock | COINon | `0xf8589b526fdd65f7f301c605a6e04f0f1b4b3620` | TRADING | COINB | `0x585bde7c54abb5ccd7791f923d6c2187635f3952` |
| CRCL | stock | CRCLon | `0x992879cd8ce0c312d98648875b5a8d6d042cbf34` | TRADING | CRCLB | `0x80f3d493ebce97e343c53d29a137942416b4ffc0` |
| CRWV | stock | CRWVon | `0x76e39171cb665a35981e744e2ceb7012f76caeac` | TRADING | CRWVB | `0x33e7317e17838fee56b10fe8d0b9ca6ca3090c95` |
| DRAM | ETF | DRAMon | `0x087b5761b161429013d41ea54cd2fb6022a21564` | TRADING | DRAMB | `0x93862d63fd9fd488b1328e9b47717d75e994a84b` |
| EWY | ETF | EWYon | `0x12b7adc48416a103f63e7e6210f62c81dfb91fd0` | TRADING | EWYB | `0xbe82f76637dba2c114c41df856c2c51e522e2cb8` |
| GLW | stock | GLWon | `0x25a4dbae9a0cd8c75656d6b50ffdf4900cc20d8f` | TRADING | GLWB | `0x740e075cbbea22a082b9d6679e65e82767875b6a` |
| GOOGL | stock | GOOGLon | `0x091fc7778e6932d4009b087b191d1ee3bac5729a` | TRADING | GOOGLB | `0x3f53de71c126bdabae20f9cd64848d317f6c3238` |
| HOOD | stock | HOODon | `0x19601179a60f55ff6636f5d1a8b6671053bd60a8` | TRADING | HOODB | `0xa394dcea3fd3847fd793afbfd163e2e3858b7c65` |
| IBM | stock | IBMon | `0xe8ff70859ce4cbd72e4352b4fb45f5bf39d07464` | TRADING | IBMB | `0xfa273b076feb8c0fb34e554ae341082323d016a3` |
| INTC | stock | INTCon | `0xa528caaa2f96090e379d43f90834c75df54d6e74` | TRADING | INTCB | `0xe614e2fc6c787035ff51f452e8e826bfd32d5283` |
| LITE | stock | LITEon | `0x0facafb97ffdba3cae88512070af49bd30674cd9` | TRADING | LITEB | `0x64748bea17b6d19e242adf20425de2440c656142` |
| META | stock | METAon | `0xd7df5863a3e742f0c767768cdfcb63f09e0422f6` | TRADING | METAB | `0x7425889fe94f9d693e8daefe88bcced6acfef4c0` |
| MRVL | stock | MRVLon | `0x1501ec83ffef405b4331cc4f73277a40fb0c627d` | TRADING | MRVLB | `0x16cd4fe7e8880ecc3ba222795229e20489fc2c76` |
| MSFT | stock | MSFTon | `0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3` | TRADING | MSFTB | `0x80106cb3ead06659a5ad19df39d9b4733863b9b0` |
| MSTR | stock | MSTRon | `0x7313ea16493b2f55054df0131a3a14b043ec8992` | TRADING | MSTRB | `0xe87afb3076aeb0f9b14e368de8145ae6a2826a14` |
| MU | stock | MUon | `0x8b6acf6041a81567f012ff6a4c6d96d5818d74bf` | TRADING | MUB | `0xcdf2f3e0fa43c47a6662a91c9e4a7c5f69762699` |
| NBIS | stock | NBISon | `0xee268780473e7a0e47bac41547c6e01512555a16` | TRADING | NBISB | `0xe256bc2a4f5297f8ba6f043f180a46300ecbcbb1` |
| NOK | stock | NOKon | `0xe9518cb0010c717db69001f1418eff9e97330137` | TRADING | NOKB | `0x7c4d7a180d737dd5a70d8065a90e6746a69c37ea` |
| NVDA | stock | NVDAon | `0xa9ee28c80f960b889dfbd1902055218cba016f75` | TRADING | NVDAB | `0x02fca66c1d1afb4e2a7884261eb00f63598a7436` |
| ORCL | stock | ORCLon | `0x03e4bd1ea53f1da84513da0319d1f03dd1bbcf93` | TRADING | ORCLB | `0x4684d9887fc1c71cba7bab8e88835cec217eb598` |
| PLTR | stock | PLTRon | `0x9351abd19f42101dd36025e495b98e910b255d78` | TRADING | PLTRB | `0x0ca5d51d0277bd006fd9607d3e560785ebad8222` |
| QCOM | stock | QCOMon | `0xfbd4d681c92ead6af0e49950c8b2e47eeacbb2db` | TRADING | QCOMB | `0x5f7a56e877b9130608bf8be962621011182fefe1` |
| QQQ | ETF | QQQon | `0x0cde6936d305d5b34667fc46425e852efd73559a` | TRADING | QQQB | `0x205812cdbed920aff76c6580abd681a46d11efc7` |
| RKLB | stock | RKLBon | `0xb4d695569236273745b4cd54b539b1b9cc1513af` | TRADING | RKLBB | `0xc8da12cbcce7c45180692a6420b0076e03a5179a` |
| SKHY | stock | SKHYon | `0x4268f2bfb23a7496504aa5ed1ee325248586299f` | TRADING | SKHYB | `0xca750ef65f295bbecd685abf54e82caf297bdb61` |
| SNDK | stock | SNDKon | `0x4fd67cb8cfedc718bac984b5936abe3330d0a2a4` | TRADING | SNDKB | `0x3ee4df61bd4f867e349beae8bfe07bc31b4850fb` |
| SOXL | ETF | SOXLon | `0xb943c8a0d77b656daf5244da060d647fd9152289` | TRADING | SOXLB | `0xd97d097a89113fa59b76c572e5b2eb647e8eefaf` |
| SPCX | stock | SPCXon | `0xd0a58bc9d88d3ff48c0294cb7e45937d0e41a928` | TRADING | SPCXB | `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1` |
| SPY | ETF | SPYon | `0x6a708ead771238919d85930b5a0f10454e1c331a` | TRADING | SPYB | `0x7138b48df7d98d7e3cc221bfe7192d0a178182d8` |
| TQQQ | ETF | TQQQon | `0xe42cfb20e00912409b77a602b5bdcff3c7acc5f4` | TRADING | TQQQB | `0x462b5f13b7c7748279358962925c5de83bb9e598` |
| TSLA | stock | TSLAon | `0x2494b603319d4d9f9715c9f4496d9e0364b59d93` | TRADING | TSLAB | `0x5b1910eaad6450e50f816082aa078c41f10c292f` |
| TSM | stock | TSMon | `0xc37042a7a4fa510d8884a433762ab87257b91965` | TRADING | TSMB | `0xab78b89b5bb00236be0b4b20704cbfa04efc711c` |
| WDC | stock | WDCon | `0xceb29848d04ad3cb46e1fe8e45b82ffac39d797d` | TRADING | WDCB | `0xebe29695f8047c13d36e7a790ca8c1b239ffad1c` |

Every bStock row was `TRADING` with `openState: true`.

### 7.2 bStock only (6 in `/tokens`) and bStock found only through `/search`

| Ticker | Name | Type | Symbol | Address | Decimals |
|---|---|---|---|---|---|
| INTW | 2x Long INTC Daily ETF - GraniteShares | ETF | INTWB | `0x0735d9904b7e34e6fe39b0f66e00c111b3f2b681` | 18 |
| KORU | Daily MSCI South Korea Bull 3X ETF - Direxion | ETF | KORUB | `0x1ffad32d69c5fead99f88c25ca0191edc3757636` | 18 |
| MUU | Daily 2X Long Micron ETF - Direxion | ETF | MUUB | `0x0bb3fa77e0809f42948e435f04883c25415e8263` | 18 |
| MVLL | 2x Long Marvell Daily ETF - GraniteShares | ETF | MVLLB | `0x7c26a12f20507e2cee22ceebed9e88fda47f866c` | 18 |
| QNT | Quantinuum Inc. | stock | QNTB | `0xd721c192d612db77621df57a9fab38418033c02e` | 18 |
| SNXX | 2X Long SanDisk Daily ETF - Tradr | ETF | SNXXB | `0x9e82e3da8f1115b73d24bb24113ab836ffdab6b6` | 18 |
| AAPL | Apple (via `/search` only, **not in `/tokens`**) | stock | AAPLB | `0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a` | 18 (UNVERIFIED on-chain) |

A live quote for $10 USDT to AAPLB succeeded through LiquidMesh / Uniswap V4 with price impact
0.045 bps. So AAPLB is tradable even though it is missing from `/tokens`.

### 7.3 Ondo only (402)

See the appendix at the end of this file. 51 are `UNSUPPORTED (closed)` and 42 are
`MARKET_PAUSED (closed)`. Do not list those as buyable.

---

## 8. AI execution layer: what a server can actually use

| Product | What it is | Unattended from Stax's server? |
|---|---|---|
| **Web3 REST API** (§1–6) | HMAC-signed REST | **Yes.** Discovery, prices, quotes, unsigned calldata, simulation, balances. It stops at the unsigned tx: signing and sending stay in Stax's own stack (Privy + ERC-4337 + Pimlico). |
| **Agentic Wallet** (`baw` CLI) | A skill package (`npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet`) that an interactive LLM agent shells out to. MPC keyless: "the private key is never fully reconstructed on any single device or server". | **No.** `baw auth signin` returns a pairing code, the human confirms in the Binance app, and `baw auth verify` blocks up to 5 minutes. No session reuse or unattended re-auth is documented. Spend limits live in the Binance app UI, not the API. (DOCS: repo `references/authentication.md`) |
| Agentic Wallet commands | `auth`, wallet view, `send`, `approvals`, `market-order {swap,quote,list}`, `limit-order {buy,sell,cancel,list}` (**BSC and Solana only**; per-token support decided at execution), `external-sign` (EIP-712 or arbitrary calls, needs `devMode.enabled`), DeFi, prediction, `x402-payment`. Tokenized-stock providers: Ondo `type=1`, xStocks `type=2`, bStock `type=3`. A campaign may count only bStock trades toward PnL. | DOCS |
| **Binance Agentic MCP server** | A CEX surface (Spot, Margin, Convert, Futures) on a dedicated sub-account. OAuth in a desktop browser, human "yes" before any order, no withdrawal scope. | **No.** It is also a different product from the on-chain Agentic Wallet despite the name. |
| **Wallet Skills** | Umbrella name for the packaged `SKILL.md` prompt modules | Underdocumented; UNVERIFIED |
| **BNB Agent Studio** | `npm i -g @bnbagent/studio-cli` (`bag`). Deploys a containerised agent (own wallet, LLM, signing) to AWS AgentCore (default) or Azure Foundry. It registers an **ERC-8004** identity on deploy, exposes an **ERC-8183** task interface, and self-funds LLM calls over x402 (default aggregator Pieverse). Wallet providers: TWAK (Trust Wallet), Altana, Turnkey, `evm-local`. Testnet sandbox: 48 h free, gas sponsored; mainnet costs `$U`. | **Possibly.** Whether `evm-local` or Turnkey sign unattended is UNVERIFIED. It is the only Binance-side path that might. The ERC-8004 registry address and interface compatibility with Stax's `IdentityRegistry` are UNVERIFIED. |
| **b402** (x402 on Binance) | `POST /api/v2/b402/{supported,verify,settle}` (v1 legacy), same auth. Payload: `x402Version: 2`, `accepted.scheme` `exact`\|`upto`, `network` `"eip155:56"`, `amount` in atomic units, `asset`, `payTo`, `payload.signature`; `extra.assetTransferMethod` `eip3009`\|`permit2-exact`\|`permit2-upto`. Verify returns `{ isValid, payer, invalidReason }`; settle returns `{ success, transaction, payer, network, amount, errorReason, errorMessage }`. | DOCS. A payment rail for agent-to-merchant payments, not for trading. |

**The honest integration claim:** Stax's server runs on the Web3 REST API end to end. Signing is
Stax's own: Privy embedded wallet, ERC-4337 account, Pimlico, and on-chain limits in
`StaxExecutor` + `InferenceVerifier`. Agentic Wallet can only be reached from a user's own
interactive agent session. The realistic hook is to export a Vera plan as `baw market-order`
commands that the user's own agent runs. Do not claim Autopilot executes through Agentic Wallet.

---

## 9. Chain facts (LIVE unless marked)

| Fact | Value |
|---|---|
| Chain id | 56. viem `bsc` from `viem/chains`. |
| Public RPC | `https://bsc-dataseed.bnbchain.org` |
| Explorer | `https://bscscan.com` (DOCS) |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032`: bytecode present on BSC |
| Pimlico | `https://public.pimlico.io/v2/56/rpc` answers `eth_supportedEntryPoints` with the same list as Base (incl. v0.7). Paymaster sponsorship on 56 with our key: UNVERIFIED. |
| USDT (BEP-20) | `0x55d398326f99059fF775485246999027B3197955`, **18 decimals** (`eth_call`). The Binance quote priced it about 1:1 USD (`tokenUnitPrice 0.99954`). |
| USDC (BEP-20) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`, **18 decimals** (`eth_call`) |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| Binance aggregator router / spender | `0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5` |
| Gas | legacy only through the API (`eip1559GasPrice: null`); `/swap` returned `gas: 450000` for one hop |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11`: viem's `bsc` definition (UNVERIFIED on-chain this session) |

**Both BSC stablecoins are 18 decimals.** Every `* 1_000_000` in Stax is a 10^12× bug on BSC.

---

## 10. Open questions (resolve before relying on them)

1. ~~Does `/swap` calldata deliver output to `msg.sender` (the executor) or to
   `userWalletAddress` / `tx.from`?~~ **RESOLVED (LIVE-calldata, 2026-09-24, Task 8).** Built a
   real $6 USDT→NVDAB quote + swap for a public, USDT-holding BSC address (Binance hot wallet
   `0xF977814e90dA44bFA03b6295A0616a897441aceC`), then `simulate`d it as that address: it
   reverted with `"execution reverted: BEP20: transfer amount exceeds allowance"` — a revert on
   the very first `transferFrom` that pulls USDT *in*, before the swap's output side ever runs,
   so `simulate` alone can't observe the output leg. Fell back to inspecting `tx.data`: the
   `userWalletAddress` used for the quote/swap **never appears anywhere in the calldata**, in
   two independent builds for two different `userWalletAddress` values (the hot wallet above,
   and PancakeSwap's router `0x10ED43C718714eb63d5aA57B78B54704E256024E`) — same pair, same
   amount, different taker each time, zero byte-level dependence on the taker beyond the
   cosmetic `tx.from` field the API echoes back. Binance's aggregator is a plain
   call-and-forward router with no recipient parameter: **output goes to whoever calls it
   (`msg.sender`) — `userWalletAddress` only affects quoting/RFQ eligibility, never
   delivery.** Caveat: calldata evidence rules out a recipient derived from `userWalletAddress`,
   but cannot by itself tell `msg.sender` delivery apart from `tx.origin` delivery. The two
   differ on the direct path, where `tx.origin` is the ERC-4337 bundler. `simulate` could not
   settle it (it reverts on allowance before the output leg). The first funded $6 trade settles
   it: check that the tokens land in the smart account. This is not a blocker for either path: on the direct path `msg.sender` is the
   user's own smart account, so output lands correctly by construction. On the executor path,
   `StaxExecutor.investWithAI` already calls `leg.router.call(leg.swapData)` itself (making the
   executor `msg.sender`) and measures `IERC20(tokenOut).balanceOf(address(this))` before/after
   to forward the *received* delta to the user (`StaxExecutor.sol` lines 110–117) — exactly the
   pattern Binance's msg.sender-only delivery needs, with no code change required. `taker` in
   `QuoteParams` is kept as the executor address (once deployed) or the smart account (direct
   path) purely so `userWalletAddress` is always sent, per the RFQ-eligibility rule above.
   Script: `resolve-recipient.mjs` / `compare-taker.mjs` (session scratchpad, not committed;
   no key material in either file, no transaction signed or broadcast).
2. Is `enableRfq=false` honoured on `/quote` and `/swap`? What routes USDT to AAPLon through
   Ondo RFQ rather than `SWAP`? Only `SWAP` was ever returned; RFQ was inferred from an error message.
3. Rate-limit window length, whether limits are per endpoint, and the over-limit response
   (`429` or `418`).
4. `quoteId` TTL.
5. Why `/platforms` counts (ondo 458, bstock 80) exceed `/tokens` (442, 46), and why AAPLB shows up
   in `/search` but not `/tokens`.
6. Does `tabId` need another parameter, or is it unimplemented?
7. Units of `tradeFee` and `estimateGasFee` in a quote.
8. Fee revenue-share payout mechanics, and whether `REFERRER_NOT_ACTIVATED` (`40469`) means the
   referrer wallet must be registered first. The docs pages were empty.
9. Agent Studio: can the `evm-local` or Turnkey providers sign BSC swaps without a human? Is its
   ERC-8004 registry the same contract pattern as Stax's `IdentityRegistry`?
10. Does Pimlico sponsor user operations on chain 56 under the Stax key and policy?
11. Does portfolio PnL (`/market/portfolio/*`) track an ERC-4337 smart-account address?
12. Is `X-OC-NONCE` enforced?

---

## Appendix: Ondo-only BSC tokens (402)

Snapshot 2026-09-24 12:28 UTC. All `decimals: "18"`. Type `null` marks rows where the API
returned `assetType: null`.

| Ticker | Type | Symbol | Address | Status |
|---|---|---|---|---|
| AAL | stock | AALon | `0x02d608506ca0048d0d991a11f1e7fb8cad1e44f8` | TRADING |
| AAON | stock | AAONon | `0x0b61036b5182a29a228d8ed9e647a16f62bad1bc` | TRADING |
| AAPL | stock | AAPLon | `0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4` | TRADING |
| ABBV | stock | ABBVon | `0x8677abad7b458bf16a0fb2676dfc7d3f55ac202a` | TRADING |
| ABNB | stock | ABNBon | `0xef80743f78d98fc2b47a2253b293152ce8b879ba` | TRADING |
| ABT | stock | ABTon | `0x5a20886b575058dd7299785f0ea9b1172942a3e0` | TRADING |
| ACHR | stock | ACHRon | `0x91c62325f901ee29da8e521cfe68980332a4ca06` | TRADING |
| ACLS | stock | ACLSon | `0xf2e14fce9259c8a7903c4be5326058ae2d004fc7` | TRADING |
| ACMR | stock | ACMRon | `0xc5efd0c3a8ff6d9816da7b56625ab4c398eb9e08` | TRADING |
| ACN | stock | ACNon | `0x7af44d51d1fb88c5b74fc71d3cba649bb8099d14` | TRADING |
| ADBE | stock | ADBEon | `0xcb22db0ecb6fe58b7b47db443dcfdfdfbf729cef` | TRADING |
| ADI | stock | ADIon | `0x0e246e05212dbbd78a354c072a92b4e5723b2fa0` | TRADING |
| AEHR | stock | AEHRon | `0xdce0957e22f7baf2aa1a50d854e03cee6f215004` | TRADING |
| AG | stock | AGon | `0xa2a97e3d6140e8ccd058f3b84230f3e1a349b1a3` | TRADING |
| AGG | ETF | AGGon | `0x08ce97f3d5cf11e577d091ab048bc5e2eae3fabb` | TRADING |
| AIP | stock | AIPon | `0xae922b6cc2371b6dce592a82fac15ef890a7d467` | UNSUPPORTED (closed) |
| AIQ | ETF | AIQon | `0x333932f15e6e14f4a630163d3224548a721ddfa4` | MARKET_PAUSED (closed) |
| ALAB | stock | ALABon | `0x573e11cc667a8e5be0c7af2410403371088d3d0d` | TRADING |
| ALB | stock | ALBon | `0x0b790abd6594918de1022233b7cc79badb84d92a` | TRADING |
| ALOY | stock | ALOYon | `0x941e3a7a6fc97b094c63a0348367cf90d93ff090` | MARKET_PAUSED (closed) |
| AMAT | stock | AMATon | `0x5ecc352c4640f1d26bd231dbbd171f40f7d0eec6` | TRADING |
| AMC | stock | AMCon | `0x1d7b5e06fdbe4fd33f5c64c081e32b5d539751d0` | UNSUPPORTED (closed) |
| AME | stock | AMEon | `0x7a5bd36047a9d15c90fa79b0654de8dd9d6ebbb1` | TRADING |
| AMGN | stock | AMGNon | `0xfbdf0366f800cc79d6663da26bc0bf21fb455aa6` | TRADING |
| AMKR | stock | AMKRon | `0xb84e150a1d18380cfeeebcde8756368dd489a1a3` | TRADING |
| AMZN | stock | AMZNon | `0x4553cfe1c09f37f38b12dc509f676964e392f8fc` | TRADING |
| ANET | stock | ANETon | `0x538e2838f9ebc9b891399df4a8dcc42890d9dc20` | TRADING |
| AOSL | stock | AOSLon | `0x55b8cc618c4209a97250dff926d3d708814d36aa` | UNSUPPORTED (closed) |
| APH | stock | APHon | `0x70afc3a600f843d2018df16b0b316e4bc9c603e9` | TRADING |
| APLD | stock | APLDon | `0x18de24acb876c0b8392d9c55583bb21c0355980b` | TRADING |
| APO | stock | APOon | `0x5630b5741a33371d9d935283849a16dc808f7f3a` | TRADING |
| APP | stock | APPon | `0xedb3124e96c64c177eb709cbc64f9977db40ea74` | TRADING |
| ARGT | ETF | ARGTon | `0x2b08f1c28cb1ede3b11d397929f00215fa97ecfa` | MARKET_PAUSED (closed) |
| ARQQ | stock | ARQQon | `0x1161989389a991532dce453d04d6346c2581c907` | MARKET_PAUSED (closed) |
| ASML | stock | ASMLon | `0xb034f6cb52b7f2fd5a7eeeffca6b9adcd6b9a6f6` | TRADING |
| ASTS | stock | ASTSon | `0x45abf29515bc23f8c0ed2a06584444ce473a75fb` | TRADING |
| ATKR | stock | ATKRon | `0xafaa2087093b7b396adab8216506d9066c6a6f13` | MARKET_PAUSED (closed) |
| AUR | stock | AURon | `0x66a1409fe303d00209202933e3d31ee43aaab39d` | UNSUPPORTED (closed) |
| AXP | stock | AXPon | `0xd803f8777187d6dee1ea57854aeb957043fb1675` | TRADING |
| BA | stock | BAon | `0xf21132a811ad1a878e21af60f64d4e690c9daa42` | TRADING |
| BAC | stock | BACon | `0xd615468088b19fb9d4f03cb3ce9e33876ff3db99` | TRADING |
| BAI | ETF | BAIon | `0x2659dd96def34ced3679901e5500779be297fe5a` | TRADING |
| BBAI | stock | BBAIon | `0x7ba995f1662a01f3be0dc299ce94bb7e9c7075f5` | TRADING |
| BE | stock | BEon | `0x17d03ae104a9d12e9e5794efb109b817dd7f3404` | TRADING |
| BIDU | stock | BIDUon | `0x467e59ce5d5fe01686d4a80dd1e1dae13549aa6c` | TRADING |
| BIL | ETF | BILon | `0x03f09e2ef6e64d804a5579e21e7b519db174cf54` | TRADING |
| BILI | stock | BILIon | `0x91fc7371d6de682a1e8cfcb4eb7da693312a03a4` | TRADING |
| BINC | ETF | BINCon | `0x940f442746d9ae699e63c378d52c4494ea02684f` | TRADING |
| BKCH | ETF | BKCHon | `0x2291e5361f4ef7bb0d6703377bf497bfe4325152` | TRADING |
| BLCR | ETF | BLCRon | `0x398ae5b33505f121c359f22b300fbcfa81db79ae` | TRADING |
| BLK | stock | BLKon | `0x24f5471183ea549987f245d6ce236b6108869c92` | TRADING |
| BLSH | stock | BLSHon | `0xfbe22d27b6e153244882fd7bdfe7c6109918281b` | UNSUPPORTED (closed) |
| BMNR | stock | BMNRon | `0x52ad57a7ea642e99a892afc79e937b383f1b59e9` | TRADING |
| BNO | ETF | BNOon | `0x5f2d37192576a6804f44722eb828e280d5fb43dc` | TRADING |
| BOT | stock | BOTon | `0xc43ae29afe58bf90da6fe3edd570c2e735fb2850` | UNSUPPORTED (closed) |
| BOTZ | ETF | BOTZon | `0xb42f5597eadd424de67b46fe5d1ec4b61367a4e5` | TRADING |
| BRHY | ETF | BRHYon | `0x6860a2f969a8133a23421ddce21397995139d7e8` | TRADING |
| BRLN | ETF | BRLNon | `0xd41829dec8b51119176ee0a6b73bc8b2718546a9` | TRADING |
| BRTR | ETF | BRTRon | `0x463196cc72cbad2d1ac1896cde0766bfbbd64443` | TRADING |
| BTDR | stock | BTDRon | `0x3a562836afb1026f5d7a6b6da1125d27fdfee372` | TRADING |
| BTG | stock | BTGon | `0xe2ac868f2fd097086d83bc939248e5ae08d35da4` | MARKET_PAUSED (closed) |
| BTGO | stock | BTGOon | `0x5fa699c0c1319b8d86489af77dfde4fa97b47df8` | TRADING |
| BWET | ETF | BWETon | `0x472f46c5d7409c82234701eff7d4dda4c28b5a93` | MARKET_PAUSED (closed) |
| BZ | stock | BZon | `0xc2c7fcddc37f6737ca2481ebda6b81ee279fe20c` | MARKET_PAUSED (closed) |
| C | stock | Con | `0x8ddb97556f6ae98b4d408c56b167139fe1cbe3e8` | TRADING |
| CAMT | stock | CAMTon | `0xc2f65e745fd13af1d00d5c81dd33f762fb81c264` | TRADING |
| CAPR | stock | CAPRon | `0x812fc2943371c952c6c8daf99fe665eb0e40cd27` | MARKET_PAUSED (closed) |
| CAT | stock | CATon | `0x274b0cb6db9473245a31cdea9b789786f4108e4b` | TRADING |
| CCJ | stock | CCJon | `0xa75f08b9a91439daac9cc7072857cc0a98cf527a` | TRADING |
| CEG | stock | CEGon | `0x65d84f0990b7394209d591380c2952c83d778aa3` | TRADING |
| CEVA | stock | CEVAon | `0x8b68b3d3173c406d2c5f4f2107d54e6562a23120` | UNSUPPORTED (closed) |
| CIBR | ETF | CIBRon | `0xdcd4536508060dab8f43c334b3a6c72c39528da5` | TRADING |
| CIEN | stock | CIENon | `0x89a9f7114be6b220fae645ba0cbb720889867415` | TRADING |
| CIFR | stock | CIFRon | `0xdad07d0ca26ed4109bc00893dbee3ed4ce8ce2a4` | UNSUPPORTED (closed) |
| CLF | stock | CLFon | `0xac38a6608868e2f487d7993ea7339c69e5ab077b` | TRADING |
| CLOA | ETF | CLOAon | `0x4ef383f521e803863a33fca8f3f861e53ef9ef9b` | UNSUPPORTED (closed) |
| CLOI | ETF | CLOIon | `0xd7e3317d54473dab04135fb0676623f237ff5ca9` | MARKET_PAUSED (closed) |
| CLS | stock | CLSon | `0x7b695132b165cb6703f0212bbb1e91a782526156` | TRADING |
| CMG | stock | CMGon | `0xaed5985afc12aa09d87f55b4b1e6bc3b8f7b0208` | TRADING |
| COF | stock | COFon | `0x53a8c5fc5643b437779742f494691e6b7c660a8b` | TRADING |
| COHR | stock | COHRon | `0x0585756aafb241b0f8a9df62db26c566091bde0b` | TRADING |
| COHU | stock | COHUon | `0x58ce0de0ced164f2aeab5fcf81d67f3c61cb562c` | MARKET_PAUSED (closed) |
| COP | stock | COPon | `0x0d586b51a90dc999f9bb6a0506da7f034a1d3a2e` | TRADING |
| COPX | ETF | COPXon | `0xec93fe7ff4b09ca3ccafbc4cc9615e62be412780` | TRADING |
| CORO | ETF | COROon | `0x23def658ea0b4081161d9ab8fdfeef5345bcafbd` | TRADING |
| CORZ | stock | CORZon | `0x25ed86472cf3012607dc6576c58e6432968255c2` | TRADING |
| COST | stock | COSTon | `0x34375f826fd3dd4e15f883d4f4786bb45eb705ac` | TRADING |
| CPER | ETF | CPERon | `0x0888edfec4c0a66fce074796cf4f6509c00f6c49` | TRADING |
| CPNG | stock | CPNGon | `0x19904bc04c09e5d29ed216ddd105bdf103a0ba2d` | TRADING |
| CRDO | stock | CRDOon | `0xf157481bebd0c0686780fd0f61806c900a6137e8` | TRADING |
| CRM | stock | CRMon | `0xd04a2bb053277721a8321d7441eed5b42fdf7250` | TRADING |
| CRWD | stock | CRWDon | `0xe6837794fbc6dd024733a1a31f86061296fa2752` | TRADING |
| CSCO | stock | CSCOon | `0x34304f2f7cc487eb4186e6d69f5905a613474aa2` | TRADING |
| CVNA | stock | CVNAon | `0xc145dc2ebdbe8ead1fecdebf46c76eb1fdd0104d` | TRADING |
| CVX | stock | CVXon | `0xd3113a0ad20a46f6a662c63fe8e637f7713e59c7` | TRADING |
| DASH | stock | DASHon | `0x7567c2a46bce46373b454682f3d95e6535bde144` | TRADING |
| DBC | ETF | DBCon | `0xfc2067e3e6a289c205151d96ef67a032f339566d` | UNSUPPORTED (closed) |
| DE | stock | DEon | `0x90ccbb75d61cb65cd73a3abb5df04a75961612b7` | TRADING |
| DELL | stock | DELLon | `0xf26518958935654878de15be7bc79a26971583ba` | TRADING |
| DGRW | ETF | DGRWon | `0x1cd89241b26fcdc421fd02907d6504c8abbfe1bc` | MARKET_PAUSED (closed) |
| DGXX | stock | DGXXon | `0x09f5a6ee1b46787dd252827e40502c4980a0285d` | TRADING |
| DIS | stock | DISon | `0xeee9eee593cb8f7946260b4066cba7907f40acfa` | TRADING |
| DNN | stock | DNNon | `0x70bd780076e25d087ed9c35f4e4a540522abe8cf` | MARKET_PAUSED (closed) |
| DRS | stock | DRSon | `0x2a0a317660f497d4c4836d1ef5faf5970e69437b` | UNSUPPORTED (closed) |
| DTCR | ETF | DTCRon | `0xec4c1944682b8c7ba6c825e9a8b2b32cb5ecace5` | MARKET_PAUSED (closed) |
| DYNF | ETF | DYNFon | `0x96a1b43c8146e6d1f6e66b226a3c520cbe3d8a50` | TRADING |
| ECH | ETF | ECHon | `0x551f8db0da800c910e12cf991eac306714481685` | TRADING |
| ECO | stock | ECOon | `0x660ab35be0f102a1d4d4b60a96ac3abfd345e038` | TRADING |
| EEM | ETF | EEMon | `0x00c81d35eddf44c75d4db9e07bdcdc236eb0ebcf` | TRADING |
| EFA | ETF | EFAon | `0x38b9a53bfdc5dba58a29bd6992341927c2fca637` | TRADING |
| EFV | ETF | EFVon | `0x40375e3dd70232eaf264706e5662b90a079e3d31` | TRADING |
| EMR | stock | EMRon | `0x60b273bdf00a9a52238ca706257f61efc55bdee0` | MARKET_PAUSED (closed) |
| ENB | stock | ENBon | `0x5397cb3f1e419050d9d7160756de0f4ed4f5f898` | TRADING |
| ENLV | stock | ENLVon | `0x5a9d924fc336a5ec8cf3b1909aa660533b50b015` | MARKET_PAUSED (closed) |
| ENPH | stock | ENPHon | `0x30938154e2697694f41592c2e48459287debe4bf` | TRADING |
| ENTG | stock | ENTGon | `0xfb4a89a077b9020c7101b1af760beb708f37a416` | TRADING |
| EQIX | stock | EQIXon | `0xe4e12c9cec3e8cae405202a97f66afa695075fa0` | TRADING |
| EQT | stock | EQTon | `0x9a1c88ac479906a7f03e76605b15b72df10d8e51` | TRADING |
| ETHA | ETF | ETHAon | `0x04b16ff1f9673146f68aa5d5f57aa45adcf068e1` | TRADING |
| ETN | stock | ETNon | `0x4697b2a050f7b5a8e1ebc27c325f9d78d094f041` | TRADING |
| EUHY | ETF | EUHYon | `0x93eb8376ec73dd07f46ba7ae1ee9b0bbd937ad93` | TRADING |
| EWJ | ETF | EWJon | `0x82715299f3f132fb85f3de1f7e8fafd3d79f3eb5` | TRADING |
| EWZ | ETF | EWZon | `0x9876f4b879cde9aa49ffd260034a0698b7b33a49` | TRADING |
| EXOD | stock | EXODon | `0x92d504158a8dc69de989db5ede3230d958fb8630` | UNSUPPORTED (closed) |
| EXTR | stock | EXTRon | `0x1eada1306df72a5607827416c1a1307d7056dfff` | MARKET_PAUSED (closed) |
| F | stock | Fon | `0xb1aba049c42b6fe811766eba61f51f11c57acc4b` | TRADING |
| FCEL | stock | FCELon | `0x47bfe4921bd74c66c6b0c35c517abdfb5e3bafb3` | TRADING |
| FCX | stock | FCXon | `0xe3b17e6d290a0f28bd32af4064637057627004d5` | TRADING |
| FFOG | ETF | FFOGon | `0xea130432a9fee9ca1a7eda84028650d38bd0e232` | UNSUPPORTED (closed) |
| FGDL | ETF | FGDLon | `0xee0d57462f20434030b8262204c00c0ea0399c41` | TRADING |
| FIG | stock | FIGon | `0x93fac02b22b6743423381d163aec418178019b7a` | TRADING |
| FIGR | stock | FIGRon | `0x620477782cea4c4171165396f8014edef83a13da` | UNSUPPORTED (closed) |
| FLEX | stock | FLEXon | `0x102138be022f8d142bcb817f7264921d65209608` | TRADING |
| FLHY | ETF | FLHYon | `0x240eb4859b4537d250cf784cc758c404da5fe4bd` | MARKET_PAUSED (closed) |
| FLNC | stock | FLNCon | `0xf1a96d4b591e446445600789d60c73dd636b357c` | TRADING |
| FLQL | ETF | FLQLon | `0x48187890d16aee64798e02c5bed510f4db5694a9` | UNSUPPORTED (closed) |
| FN | stock | FNon | `0xa1daab37da2a29a1ec721922b55962eb8b481001` | TRADING |
| FORM | stock | FORMon | `0xd678f3f86436ee298d28a3c414c367adfed65337` | TRADING |
| FPS | stock | FPSon | `0xd8daffd168651470cd5397a5d670dd5f8e4b02f5` | TRADING |
| FSOL | ETF | FSOLon | `0x54b92fd77229269ff6484942c123cca72f2d6fec` | TRADING |
| FTGC | ETF | FTGCon | `0xe96f94e10f1265dcc15f83d251f1f6758d2cd67d` | MARKET_PAUSED (closed) |
| FUTU | stock | FUTUon | `0x5acf40056ed51c8bbcd1b125ef803581ac89a627` | TRADING |
| FXI | ETF | FXIon | `0x9b8e987e6fec8cf1380c4dca7071e2c7853aeea1` | TRADING |
| GD | stock | GDon | `0x5d1a9d8aa362a6424b65fcb601e52fefce5b4efa` | UNSUPPORTED (closed) |
| GE | stock | GEon | `0x5151a22421ed4277f1e4ca4785a07b035d548a36` | TRADING |
| GEMI | stock | GEMIon | `0x817942d5de16092656568e9f67f54ccb462f8989` | MARKET_PAUSED (closed) |
| GEV | stock | GEVon | `0x2aea1d415d45ccf3eabe565d45dcaf4ea2035b9c` | TRADING |
| GFS | stock | GFSon | `0xaff6b836d3ebd29aeb0c8b840add04ef79d79678` | TRADING |
| GGOV | ETF | GGOVon | `0x8dd51e233e2344498f876c231a3bd962e9750a6c` | TRADING |
| GLD | ETF | GLDon | `0xfa9a1e901085e269f6d428f79cd5252d8b919344` | TRADING |
| GLTR | ETF | GLTRon | `0x15580092796f69825cff4738cac55d05d41eaa42` | TRADING |
| GLXY | stock | GLXYon | `0xf98b89825233808cd37706a53d2b4ae3e359d442` | TRADING |
| GME | stock | GMEon | `0xdabb9aff4cf02f26d2014e4ca9f94ac6fe6572a3` | TRADING |
| GNRC | stock | GNRCon | `0x237c9f794edaaa0071cdf64a41c25eb76771754b` | TRADING |
| GRAB | stock | GRABon | `0xab2f74804c022c5249d52e743af4340e42f5f3b6` | UNSUPPORTED (closed) |
| GRND | stock | GRNDon | `0x20cce48d767ed68cbba7727c4c504efe5bcb626c` | UNSUPPORTED (closed) |
| GS | stock | GSon | `0x0d4f9b25f81163fb4840ba4f434672543823000c` | TRADING |
| HAL | stock | HALon | `0x7a18bb5fd6ba6343180afdcf6dc406ef17f7fc04` | TRADING |
| HD | stock | HDon | `0x31dabf49e4bc1af1456c1819cb6a2562154e92f3` | MARKET_PAUSED (closed) |
| HII | stock | HIIon | `0x4dc8dcee22a56feeca930dff45581aa9a14d5e05` | TRADING |
| HIMS | stock | HIMSon | `0x4693f6f5ef257381a28afd0673e64d8b32d5c6ad` | TRADING |
| HIMX | stock | HIMXon | `0x6cf3b84f0ba4d86d9f6987812a11db2c447d9483` | MARKET_PAUSED (closed) |
| HIVE | stock | HIVEon | `0x3f19a16a401a6af05150479ccb76ef2fb57b0df3` | TRADING |
| HLIT | stock | HLITon | `0xff6f45b2d761cde4dab7f5d7a1a5f691f52f3bc3` | UNSUPPORTED (closed) |
| HPE | stock | HPEon | `0x492e678c1ea048c70edc635047cdbb87ff5362a2` | TRADING |
| HSAI | stock | HSAIon | `0x847ef23a3f99af79a185ce033e1664165b846eea` | TRADING |
| HUBB | stock | HUBBon | `0x1c42c07257f936a7c4f84b8d756c95817e23631a` | TRADING |
| HUT | stock | HUTon | `0x3a82f1c847cc55e52e597fd81c63a812c6722541` | TRADING |
| HYG | ETF | HYGon | `0x0dae81a905b645a3d1e67129b89cd0acda224e9a` | TRADING |
| HYGW | null | HYGWon | `0x85b53a9344884ae428e0e15f05a1819d280d4be7` | MARKET_PAUSED (closed) |
| HYS | ETF | HYSon | `0x75e9d68e99e76714ed1a7663ab48ba3aabd7a6c5` | TRADING |
| IALT | ETF | IALTon | `0x879fc0d8dfdb13b4af3513d9838f82c4df8f57e8` | UNSUPPORTED (closed) |
| IAU | ETF | IAUon | `0xcb2a0f46f67dc4c58a316f1c008edef5c2311795` | TRADING |
| IBIT | ETF | IBITon | `0x68b07cef227cea1b2b6683921c8c825cd5c69ec7` | TRADING |
| ICHR | stock | ICHRon | `0xfb836dc42ebdff6aa8db9339336899061d1c4f3f` | TRADING |
| IDEF | ETF | IDEFon | `0x5fb339393773414039295ea97a92614fed85d556` | UNSUPPORTED (closed) |
| IEF | ETF | IEFon | `0xa486a0a05250e8621ba3b26c3bbc517145eba619` | TRADING |
| IEFA | ETF | IEFAon | `0x918008c3d29496c37b478b611967beaca365af36` | TRADING |
| IEI | ETF | IEIon | `0x4e07b55e62f443859706e03aea0b3fe3a1bfea8b` | TRADING |
| IEMG | ETF | IEMGon | `0x22092c94a91d019ad15536725598b0a6be0a73c0` | TRADING |
| IGEB | ETF | IGEBon | `0x9e609e96b688927aa49dcd9758e2081f0c48ccab` | TRADING |
| IGV | ETF | IGVon | `0xa046c2f0a1ac0a0e8829efc12163ae892ceafac2` | TRADING |
| IJH | ETF | IJHon | `0x167e93a849a0cc479769132552b99aa1cfa0948c` | TRADING |
| IJS | ETF | IJSon | `0x9609f804fd90440dd3f4afa1e0a4d57dfd580ce8` | TRADING |
| INCE | ETF | INCEon | `0x5e24db6de4c21e2c8f9e81bacfcedfbac2dee4aa` | UNSUPPORTED (closed) |
| INDA | ETF | INDAon | `0xdb0748297fbef0b33df89e86519a0bd3adaf6459` | TRADING |
| INOD | stock | INODon | `0x517a25e696421c88218b43cbb7ea0f873b6973a6` | TRADING |
| INRO | ETF | INROon | `0x790cfb394b1f399a3543ba1f835dde114a387eeb` | MARKET_PAUSED (closed) |
| INSW | stock | INSWon | `0xe3316f5372559768e14bc7ffe983891a742987e7` | TRADING |
| INTU | stock | INTUon | `0x6e3e077a6c0e3c27fd6d00b97387d9b7bd451bab` | TRADING |
| IONQ | stock | IONQon | `0x40d8e1fbaf69173c47fa493feb50a84eec6b57ee` | TRADING |
| IRDM | stock | IRDMon | `0x3ce678692a60fb5f31963b05cb158f0ce0ff1736` | TRADING |
| IREN | stock | IRENon | `0x8fd70ee385f470c8d6fda2d93a4e49c849bac6a6` | TRADING |
| ISRG | stock | ISRGon | `0x784584933c2192caa062e90d8140d94768ce62d8` | TRADING |
| ITA | ETF | ITAon | `0x88b90f45bd6a4f97f7d85d280ed64a40880e4935` | TRADING |
| ITOT | ETF | ITOTon | `0xcf9caf83053213c44dd7027db3e1e4ac98e55f8f` | TRADING |
| IVV | ETF | IVVon | `0x1104eb7e85e25eb45f88e638b0c27a06c1a91cb2` | TRADING |
| IWF | ETF | IWFon | `0x40755f06ab7f8de1ab3a9413b1ef562d63de19b1` | TRADING |
| IWM | ETF | IWMon | `0x500eafc69b68acd6f27064f9b75f1c7d91cc4d9f` | TRADING |
| IWN | ETF | IWNon | `0xf54b94ea21e1da5d51ef00fd4502225e5394f874` | TRADING |
| IYW | ETF | IYWon | `0xbeeef4361f6603edacef5205b343c6bb6473a099` | TRADING |
| JAAA | ETF | JAAAon | `0x84719a1082ed487c7eeac7d69885e3cc2009ea78` | TRADING |
| JBL | stock | JBLon | `0x8d941ebb4921f8d43cfa65233b14a547f96559fc` | TRADING |
| JD | stock | JDon | `0xe92be960ae64f6a914ca77014cac9e56de7f36c1` | TRADING |
| JNJ | stock | JNJon | `0xd1f799cb9f5d0a02951b0755beced6c43882712f` | TRADING |
| JPM | stock | JPMon | `0x317bf42b43a394860718266dec445dcc9fd9da49` | TRADING |
| KEEL | stock | KEELon | `0x5e3ca19c533c8c0381eac5319624596557c279ed` | TRADING |
| KEYS | stock | KEYSon | `0x3de956d959726c448649354c6fbca92b82dc5ed7` | TRADING |
| KLAC | stock | KLACon | `0xfc263946439b0d802bf4c5a6fcd34e2885259f91` | TRADING |
| KO | stock | KOon | `0x405f38b90bebf1259062cf29da299f3398662bcb` | TRADING |
| KOPN | stock | KOPNon | `0xed5615c5280e897241b9e4f019562a581cd49390` | UNSUPPORTED (closed) |
| KWEB | ETF | KWEBon | `0x7437203800140ba7d9081dde8cef09ee40e3bf03` | TRADING |
| LASR | stock | LASRon | `0x476a2cad3197df68186b61bc36296e8d3d2d1b85` | TRADING |
| LECO | stock | LECOon | `0x43807bf4ce06f4fbb4fa8deac37bf274aea324da` | UNSUPPORTED (closed) |
| LEMB | ETF | LEMBon | `0x653156b9a46e21906dddc82414871bbdb0261319` | UNSUPPORTED (closed) |
| LI | stock | LIon | `0x9810beac9af3c30d14cfb61cdd557e160f60fd50` | UNSUPPORTED (closed) |
| LIN | stock | LINon | `0xe1743616f705954620aa351465c8885fbde5a8a9` | TRADING |
| LIT | ETF | LITon | `0xfd7778d5d4e804b5b512471df36d60c465199a52` | TRADING |
| LLY | stock | LLYon | `0x341d31b2be1fee9c00e395a62ba41837f4322eed` | TRADING |
| LMT | stock | LMTon | `0xd09f7b75b9659b864c6f82bb00ff096f9d277998` | TRADING |
| LOW | stock | LOWon | `0x2ec46eed30c94caa5979e6a0395abe824138335f` | UNSUPPORTED (closed) |
| LPTH | stock | LPTHon | `0x6ad19e0a57cfea0bc521a12c6c82372852842933` | MARKET_PAUSED (closed) |
| LRCX | stock | LRCXon | `0x35895a1fa1aff7fb3204fb01257409fd75acb24c` | TRADING |
| LSCC | stock | LSCCon | `0x80f03abcb2bd85237740dd69f87d2f5de3909012` | TRADING |
| LUNR | stock | LUNRon | `0xa3b7b7cfeb023a6c4f444f5ca9a3fc85809ece15` | UNSUPPORTED (closed) |
| LWLG | stock | LWLGon | `0x8ac67002282eea816afa0160d22a8d27f05ba07b` | TRADING |
| MA | stock | MAon | `0x25ffda07f585c39848db6573e533d7585679c52d` | TRADING |
| MARA | stock | MARAon | `0xd226d8170ee38793430c7dec6903df4b818bb74c` | TRADING |
| MBLY | stock | MBLYon | `0xcc977b493f52b4b6b6a0c3594530f2baee565e96` | MARKET_PAUSED (closed) |
| MCD | stock | MCDon | `0x995add4ba29a628a57930a8a185c62ca044ec090` | TRADING |
| MEI | stock | MEIon | `0x89c37104afcee9a72187e05d960a1e09763a126e` | MARKET_PAUSED (closed) |
| MELI | stock | MELIon | `0x60a8f8e05200ff73afde9e2cae819bf1605f0bdd` | TRADING |
| MKSI | stock | MKSIon | `0xd41699aa1bfc1c5f172c27f387372bd30717a5db` | TRADING |
| MP | stock | MPon | `0x4baf4dc56cf6a525a0874e25cc6372a6a8915135` | TRADING |
| MRK | stock | MRKon | `0x869027261075c3c239d6a26842579b93802606f4` | TRADING |
| MRNA | stock | MRNAon | `0x01486675da0764ee780ea7cb65c33062e9b2d28c` | TRADING |
| MTSI | stock | MTSIon | `0x1dcd320c5d7b84cd407437c58d56cbbdd0d9d8f3` | TRADING |
| MTZ | stock | MTZon | `0xf49046aae76eaeb7ffd3ef116ce0f7cd0f52d93e` | MARKET_PAUSED (closed) |
| MXL | stock | MXLon | `0x5cb7671740877723c9ad55348a751d7b57052e07` | TRADING |
| MYRG | stock | MYRGon | `0x93b83111c54aa3993b2de5fccd4c70b26c522d5d` | MARKET_PAUSED (closed) |
| NAT | stock | NATon | `0x33f3df3cea2a8c4828e88f30be932850cf749739` | UNSUPPORTED (closed) |
| NEE | stock | NEEon | `0xe9d43f7e6b2237e8873a7003b3f43c6b03160be5` | UNSUPPORTED (closed) |
| NEM | stock | NEMon | `0x5e63232993789601ce362e0240a299c1dfcbfbec` | TRADING |
| NET | stock | NETon | `0xfeb0793eea97585eb3a541f3fd53450d225b2b87` | TRADING |
| NFLX | stock | NFLXon | `0x7048f5227b032326cc8dbc53cf3fddd947a2c757` | TRADING |
| NIKL | ETF | NIKLon | `0xe23f03d2907cdc38a10f6ccdc1a157bf1afe51de` | UNSUPPORTED (closed) |
| NIO | stock | NIOon | `0xc6f9edbee6042a237d72493bbda3ee2c3c62f708` | TRADING |
| NKE | stock | NKEon | `0x04b5e199f2ec84f78b111035f57b16bee448db6f` | TRADING |
| NNE | stock | NNEon | `0x3c276dd9f9eab5510f9eafd3a6ea54879b27ca3d` | TRADING |
| NOC | stock | NOCon | `0x4d3442d884202584f1729bca20db05472b886b52` | TRADING |
| NOW | stock | NOWon | `0xeb19c13c54b1cd48afc62f6503375e92d5f1e856` | TRADING |
| NTES | stock | NTESon | `0x282973969118f9fe39bf2ff3d8dd1efee82ccb11` | UNSUPPORTED (closed) |
| NUE | stock | NUEon | `0x2155f5344ba7763f80420de617af41e56de0552b` | TRADING |
| NVMI | stock | NVMIon | `0x8a5f83a4b3ad2b9604f53c4ddf8dce1329f9d433` | TRADING |
| NVO | stock | NVOon | `0x08a513779f46ffb7a34f16094a94016d010128a8` | TRADING |
| NVT | stock | NVTon | `0x484ce83bb55b50d70236c7d1e29e0ba7524f905b` | TRADING |
| NVTS | stock | NVTSon | `0xb56b7c2f9988448790b0f78697f405ab5e8597e6` | TRADING |
| OIH | ETF | OIHon | `0x31d6011023d6c7695efc29bb016830f3f36de40a` | TRADING |
| OII | stock | OIIon | `0x4321366277d4a6e170f1f28148c93e8c47636c14` | UNSUPPORTED (closed) |
| OKLO | stock | OKLOon | `0xaf6c03acf72355ce98d0741302b78870b376428c` | TRADING |
| ON | stock | ONon | `0xb35a9eab5d25282f4e668798b629a9294e9a47aa` | MARKET_PAUSED (closed) |
| ONDS | stock | ONDSon | `0xd85d4ce29b4ca361ff72ef0e53d6236e334c5db6` | TRADING |
| ONTO | stock | ONTOon | `0x2f79d36184dfe7968c9d23f87cae1ab72447c1e5` | TRADING |
| OPEN | stock | OPENon | `0xa09699fc0cbb1f85128450a0ff6a3c4d3a7e7b9b` | MARKET_PAUSED (closed) |
| OPRA | stock | OPRAon | `0x88672043905bdd272df55a5a7bb1b7e1e693cbc5` | UNSUPPORTED (closed) |
| ORBX | ETF | ORBXon | `0x2bc97b1c5f83f080798ee9e38da5fbf621454fcf` | UNSUPPORTED (closed) |
| OSCR | stock | OSCRon | `0xb0752aa50b089ee6ea9acd51373207fa460e87bb` | MARKET_PAUSED (closed) |
| OUST | stock | OUSTon | `0x30033a17ea24e90631532582a1917c64afbf87af` | TRADING |
| OXY | stock | OXYon | `0x01b5a4ac600be98448dbefbb78bcdf38262552cc` | TRADING |
| PALL | ETF | PALLon | `0x3fcd741646a9790635b938cdb69af5df356cbaab` | TRADING |
| PANW | stock | PANWon | `0x0eaa1a75bd682a5669ab2371a559fbd039c6b9eb` | TRADING |
| PAVE | ETF | PAVEon | `0x6f28cb07790c1049ecd7482d09fd13b977b47201` | TRADING |
| PBR | stock | PBRon | `0x2b1d5cdecc356530a746c5754231efaeaca64022` | TRADING |
| PCG | stock | PCGon | `0x47b36ddb9dd12a8411f78226f55e8c3f0d65481f` | MARKET_PAUSED (closed) |
| PDBC | ETF | PDBCon | `0xcf3e84e62002ca459db81b2032d7fe13715bad51` | UNSUPPORTED (closed) |
| PDD | stock | PDDon | `0xf3e82ea164cb344b2b11bad4c24b0ea4f7ba4714` | TRADING |
| PENG | stock | PENGon | `0x2144d620e3471441b12bf256e01a09eaa5ea7f12` | UNSUPPORTED (closed) |
| PEP | stock | PEPon | `0xf99f8f3a95257d82006183bd524efa7aacc9ef7a` | TRADING |
| PFE | stock | PFEon | `0x8a83c31d6751833b4940b6e871c48d9a15a07b46` | TRADING |
| PG | stock | PGon | `0x400f1e257f86d25578a0928c94dc95115f09d5c9` | TRADING |
| PINS | stock | PINSon | `0xcfd1f0df84300ea1a4e2ba5238043a2fa5a7237c` | TRADING |
| PL | stock | PLon | `0xf9015e0b3ab4ddd216f522d6150db826c9be83f8` | TRADING |
| PLUG | stock | PLUGon | `0x4752ae8f910b25e64e4406eaad50c1b4e8de7e6d` | TRADING |
| POWI | stock | POWIon | `0x5417b7cfdb8a187004067297ebf1491c8d6d5c09` | UNSUPPORTED (closed) |
| POWL | stock | POWLon | `0xd381aec27daaccc87f102ff4ad6652f8b5f20ba0` | TRADING |
| PPLT | ETF | PPLTon | `0x3ec23f52f6573fc0587a0631dd8c3b107f6bcb35` | TRADING |
| PRIM | stock | PRIMon | `0xd60b0276640a693ece55660afac0383ca6433882` | UNSUPPORTED (closed) |
| PSQ | ETF | PSQon | `0x3802dc739ef9e226f36421a9c15efa519153bbbe` | TRADING |
| PURR | stock | PURRon | `0x89cc700f308a4c59889fbf3286216554c53b0601` | UNSUPPORTED (closed) |
| PWR | stock | PWRon | `0x2418c2e1ae3b8d767594b3974d32610743f88155` | TRADING |
| PYPL | stock | PYPLon | `0x374d03a6c0d5bd4be0a5117ebe1b49d52ac8a53f` | TRADING |
| QBTS | stock | QBTSon | `0x8c7bf0ed6bc778bde1489de1592c1aad3e66371d` | TRADING |
| QLTA | ETF | QLTAon | `0xbc34d36b70e5a256f3d16f9ca9d3ca3838f6cc4f` | TRADING |
| QTUM | ETF | QTUMon | `0x467c7cf9af95765c1bd6542ffd516bf9603a19b9` | TRADING |
| QUBT | stock | QUBTon | `0x82e07c1017032cfd889b1ca81ebe722c4d4de825` | UNSUPPORTED (closed) |
| QYLD | ETF | QYLDon | `0x64e023411215c3b75b9f339b7b77f179cd04c527` | TRADING |
| RDDT | stock | RDDTon | `0x4da12f47578ef89c76179b760c778e70b668f80b` | TRADING |
| RDW | stock | RDWon | `0x23e39d94807a8bb7e3f8294b4911d04ee26dce39` | UNSUPPORTED (closed) |
| REGN | stock | REGNon | `0x30bd85fd4286c5c9857679f5b188f737b4a7b8c0` | TRADING |
| REMX | ETF | REMXon | `0xc16f47c4a7ed39372b9a0e3e2016cede9b4cb83a` | MARKET_PAUSED (closed) |
| RGTI | stock | RGTIon | `0xed2a500eb2b66679e0bbd76e51a60049ae5f3271` | TRADING |
| RIOT | stock | RIOTon | `0xc4a88a72b848255fd24da3c1ad6755d980535fb1` | TRADING |
| RIVN | stock | RIVNon | `0x277e1fa8704c5511fed7e30bc691f922aa30101b` | TRADING |
| RMBS | stock | RMBSon | `0x49ccb157c77afe5f264c35f0e9178a98d77815ab` | TRADING |
| ROK | stock | ROKon | `0x95f7423c51eab71cbd00ca855b0b2b2153f14184` | TRADING |
| RTX | stock | RTXon | `0x44fde2c6bc2c2b54962c69fcef57a2a50121dbd7` | TRADING |
| SAP | stock | SAPon | `0x111f6f2b9f1c5f3ec841690e1deec606086727da` | TRADING |
| SATA | stock | SATAon | `0x732823512ba98d1bcde471ca023ee2a0c9f117b7` | TRADING |
| SBET | stock | SBETon | `0x99e01f02d66455bb106d91d469c9eaf6ab4904f6` | TRADING |
| SBUX | stock | SBUXon | `0x94d7754541b829a87321d56121bc544167ac490d` | TRADING |
| SCCO | stock | SCCOon | `0xf15b8f7465b92799f6ee440f86b3cab5a4dbc65a` | TRADING |
| SCHW | stock | SCHWon | `0xe5ba472c98b7e4695bd856290de66bdedaffc123` | UNSUPPORTED (closed) |
| SECU | null | SECUon | `0xb0d7d4b65a654d43f91272bb94e011ce6812a2ef` | MARKET_PAUSED (closed) |
| SEDG | stock | SEDGon | `0x8755c5c39b1aa9053a83ac731242a2cf4d04b0fe` | MARKET_PAUSED (closed) |
| SGOV | ETF | SGOVon | `0xc008c5f579ec1450f20099c39f587547e27c7523` | TRADING |
| SHLD | ETF | SHLDon | `0xe5ca1585c6053ee891027fd0a2548cb3b27d7f01` | TRADING |
| SHOP | stock | SHOPon | `0x43d0b380c33cd004a6a69abd61843881a2de4113` | TRADING |
| SHY | ETF | SHYon | `0xf95e50be5efc96117c28775f80c7cdb41ebc4888` | TRADING |
| SIL | ETF | SILon | `0x6a4c1b7aa18638fac4c8e0d1961405e27c25baf1` | TRADING |
| SLB | stock | SLBon | `0xfadde620010736a5074a4269894cb52b0a9a91de` | TRADING |
| SLV | ETF | SLVon | `0x8b872732b07be325a8803cdb480d9d20b6f8d11b` | TRADING |
| SMCI | stock | SMCIon | `0xc142ba8ccd36d80c3a001342fb83e4c3d218a873` | TRADING |
| SMR | stock | SMRon | `0xf4b674d4e33c36f8db4b928a5eec4e1f87b386e3` | TRADING |
| SNAP | stock | SNAPon | `0xf325884d9bcac457271fe7f7b6be1765348fcca2` | MARKET_PAUSED (closed) |
| SNOW | stock | SNOWon | `0x138ed6833ff4e8811e1fea0d005e13726c8886f9` | TRADING |
| SO | stock | SOon | `0xd7a6353a23ed2c4fcac29a63cbbe3f65ffef41f5` | UNSUPPORTED (closed) |
| SOFI | stock | SOFIon | `0x71507068e98049cba81e9bbc8d901e4a2f4222eb` | TRADING |
| SOUN | stock | SOUNon | `0xedcf71b2e2217064038adcb54a3c3a5fc3488ef1` | TRADING |
| SOXQ | ETF | SOXQon | `0x15688f10470dfddcb4e2d60cd2acfd3ec418317a` | TRADING |
| SOXS | ETF | SOXSon | `0x335dd4112704f108b5ddd8f8a44bd9ed68522a80` | TRADING |
| SOXX | ETF | SOXXon | `0x2a3cbf64c8181db4a25d41d4d7a7db9984c59dac` | TRADING |
| SPGI | stock | SPGIon | `0x55b370b704240a914f42b5bbb3195431c031f9f8` | TRADING |
| SPOT | stock | SPOTon | `0x50356167a4dbc38bea6779c045e24e25facedfdc` | TRADING |
| SQQQ | ETF | SQQQon | `0x17515b68378d86c38f394c666e79907da05dcba9` | TRADING |
| STLD | stock | STLDon | `0x90eaa91af0b4559f1f270258bb5cddfafbb62da9` | TRADING |
| STM | stock | STMon | `0x8b46599e0e80a34f37e97df58e741ca904cdfabd` | TRADING |
| STNG | stock | STNGon | `0x4b1c9087a6fe265a36fbf2c591b0986fe1115f50` | TRADING |
| STRC | stock | STRCon | `0x71e9dc9debc18650bd2342b93623b88c2ad00c89` | TRADING |
| STX | stock | STXon | `0x966ebcba3c51e81f5cf159a1eabefd2327ab5e8d` | TRADING |
| SWKS | stock | SWKSon | `0x7bd821eaad82cb92c1ea64dac1f3bb2e787e959a` | TRADING |
| SYM | stock | SYMon | `0xc79fc7af952c8b41c6b7b7657dd24f44f7c10f2a` | TRADING |
| SYSB | null | SYSBon | `0xebe1408a7cce4f38de15467e5139c3d82e4641f8` | MARKET_PAUSED (closed) |
| T | stock | Ton | `0x4255279af47cf10efb9a5c8839f90170f4ef759f` | TRADING |
| TASK | stock | TASKon | `0xdb69becc323fec440ca8eb0c3564802e77ce2827` | MARKET_PAUSED (closed) |
| TCOM | stock | TCOMon | `0x6459303f58244ff1e7a42b90aa3782dfb6ca6969` | TRADING |
| TEL | stock | TELon | `0x5c50ffd365c852f5e72bfbc2c1ae621e2aca5ece` | TRADING |
| TEN | stock | TENon | `0x686f8264625fe4e51f520db856003a4dd52a49ff` | UNSUPPORTED (closed) |
| TER | stock | TERon | `0x6f040fc3061374304bddbfdae9d688d7c868c785` | TRADING |
| TIP | ETF | TIPon | `0x2ac26ec236df5d1d2ad1a6dd4e448a90e45dc35d` | TRADING |
| TLN | stock | TLNon | `0xbbe4dfe7a349fb72aec6f52d5cd9bdd78ae8f313` | UNSUPPORTED (closed) |
| TLT | ETF | TLTon | `0xf69e40069ac227c11459e3f4e8a446b3401616b6` | TRADING |
| TM | stock | TMon | `0xecc1299f183b6a720a6f4729bf24f82cd8d50828` | TRADING |
| TMO | stock | TMOon | `0xbcf7d958791152128710565a5fc6f68342ed71c8` | TRADING |
| TMUS | stock | TMUSon | `0x2588f20bad92da8dcce7fac8311b5f8ab4690e43` | TRADING |
| TNK | stock | TNKon | `0x2bbf5ab85f9ceb595dd785db15cc9f2931c6ea64` | MARKET_PAUSED (closed) |
| TSEM | stock | TSEMon | `0x343324170c91c4d8cf4d439b3e5a619f50621ae7` | TRADING |
| TT | stock | TTon | `0x0afa28a7ac4e44b1f771515c200f4d67b1f5e8d0` | TRADING |
| TTMI | stock | TTMIon | `0xf400b05ad5a791c65acc3f905e5ade5f1b653c8c` | TRADING |
| TXN | stock | TXNon | `0xca3a5c955f1f01f20aacf9501b03e4aa235e478b` | TRADING |
| UAMY | stock | UAMYon | `0xf8919fe7d586b11d0a900e987c4a41bc6c3195f5` | TRADING |
| UBER | stock | UBERon | `0xde9d6036fca870f7efc5a82722ae694c371ac909` | TRADING |
| UCTT | stock | UCTTon | `0xb78ccbcd9dce42d4fa5fdc835cb6a1aa1095a3b5` | TRADING |
| UEC | stock | UECon | `0xe7ddf606841ee278a30e5c90486681e68ddd8cbf` | TRADING |
| UMC | stock | UMCon | `0x318ddd4d03d84a40cf44772385a0cfb3d4394049` | TRADING |
| UNG | ETF | UNGon | `0xa5351c9bf08055e03642b6b8649a0f7e895501bf` | TRADING |
| UNH | stock | UNHon | `0x3385cb29cca0ac66f5d2354d13ef977b49a2510f` | TRADING |
| UNP | stock | UNPon | `0xfe9aa194e3c4604f3872f220eb41c33a287fcd90` | TRADING |
| URA | ETF | URAon | `0xc7806943663158d68740a14ab0b270bd60bde87d` | TRADING |
| URNM | ETF | URNMon | `0xca626a74420aaaf285987da23d829f9159ab867c` | TRADING |
| USAR | stock | USARon | `0x2206e07410a8fe9ef595e7184b2e9d160fdb7211` | TRADING |
| USFR | ETF | USFRon | `0xf4fd75764a5c086fb12f822be2ca318b3a362dc3` | TRADING |
| USO | ETF | USOon | `0x94174e3d1335db402dd03a092f7aa7ac2cb32be4` | TRADING |
| UUUU | stock | UUUUon | `0xd2c06fef2ca2375a9c7ceb4abca9dbc2ab6af981` | TRADING |
| V | stock | Von | `0x1cde419fae0ef7f7931ae3e29e5f411c8c5e5fa1` | TRADING |
| VCX | stock | VCXon | `0xc8206bb42ec019f7e7ea060ed887e9f5bb53cbb0` | TRADING |
| VDE | ETF | VDEon | `0x9e23662f540c6bc117adf91230730d9b2fdf5643` | TRADING |
| VFS | stock | VFSon | `0x1d2eaaf0ae00382893aa4318bd88d1cd0e9b858a` | UNSUPPORTED (closed) |
| VICR | stock | VICRon | `0xa59469d91563caeeddd2ffc731f41215e7b691ef` | TRADING |
| VNQ | ETF | VNQon | `0x10b58a3d9dcec59bb1c3bf6b9c9414eafce711c9` | TRADING |
| VPG | stock | VPGon | `0xad8920afa9d158f5ebab77c9ffcad650d72e473d` | TRADING |
| VRSN | stock | VRSNon | `0x37ff203ac221313b620d047eddd7bd6f68d656a6` | UNSUPPORTED (closed) |
| VRT | stock | VRTon | `0x9cea8a7be1ab0320b709d368ad60d8500f55995f` | TRADING |
| VRTX | stock | VRTXon | `0x8c9979dc208f74a5602c38691aa920f121e2f863` | TRADING |
| VSH | stock | VSHon | `0x821aef7d0f4347bb9ea6f293a98b19d823eef0c5` | TRADING |
| VST | stock | VSTon | `0xf2c24c47805f4f72d3919c8674bfdd401505794b` | TRADING |
| VTI | ETF | VTIon | `0x158734153f354cb326ee690c3d55f810dcb0fc90` | TRADING |
| VTV | ETF | VTVon | `0xc2dd31b1b3a2f515ce0d48de712c6744c3475170` | TRADING |
| VZ | stock | VZon | `0xa3b089c886e6d721f49def8e050f3b9d4362560b` | TRADING |
| WCC | stock | WCCon | `0x82436bae31ae373258ba567f32087eefc32189f2` | UNSUPPORTED (closed) |
| WFC | stock | WFCon | `0x629520dee1620def11596f84e85de9f1ff653012` | TRADING |
| WLK | stock | WLKon | `0xb3d1a5f9bf92f18da643f2ada2f2cdfdae67e9d1` | TRADING |
| WM | stock | WMon | `0xce0466bae0e867239719dc386ca84b1f3efe6914` | UNSUPPORTED (closed) |
| WMB | stock | WMBon | `0x7b7abd762a400c9768cdeeef3c01dae39e0b8427` | TRADING |
| WMT | stock | WMTon | `0xa7d1e886acf66ec0656df2decb4b7c893a3bab4c` | TRADING |
| WOLF | stock | WOLFon | `0x55b56cc2cdcbc2c58668f72663be7599a46ed79f` | TRADING |
| WS | stock | WSon | `0x50e66edb7d0b79ee988f098754a27afaa643b4f5` | MARKET_PAUSED (closed) |
| WULF | stock | WULFon | `0xad56701d9e57957e28e546db7db508a16d4f86cc` | UNSUPPORTED (closed) |
| WYFI | stock | WYFIon | `0xce128edcf46b281b7df8880867b74e11b055e8e7` | TRADING |
| XOM | stock | XOMon | `0x4d209d275e3492ac08497a7a42915899c4dd5e86` | TRADING |
| XYLD | ETF | XYLDon | `0x1fe12abdf560c753acbc63533519d74801e04958` | TRADING |
| XYZ | stock | XYZon | `0xe778a2e5d953c82eb9475cf3b87654226a867344` | MARKET_PAUSED (closed) |
| YEAR | ETF | YEARon | `0x4277d20430e901092e259ba9cf7164c37077aaf1` | TRADING |
