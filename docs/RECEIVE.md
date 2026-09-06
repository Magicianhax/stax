# Receive on Base — three ways in, no wrong deposits

The Wallet "Receive" sheet on Base becomes a chooser with three options. Mantle keeps the plain
address + QR sheet it has today.

1. **From another wallet** — connect an external wallet (Privy `useConnectWallet`) and move USDC
   from it to the Stax account on Base in one confirmation. Gas is paid by that wallet (it is not
   our smart account); the UI says so.
2. **Add cash** — the existing Coinbase Onramp sheet when `NEXT_PUBLIC_CDP_PROJECT_ID` is set,
   otherwise a "Coming soon" tile (visible, disabled, tagged).
3. **From any network** — a universal deposit address. The person picks the network and the
   token first, then sees an address + QR that is only valid for that pair, with a loud "send only
   TOKEN on NETWORK" line. Anything sent there is bridged by Relay and lands as USDC on Base in the
   Stax account. If they pick Base + USDC we show their own account address (no bridge).

## Relay (docs.relay.link/features/deposit-addresses) — server only

- Networks/tokens: `GET https://api.relay.link/chains` → `chains[].{id,name,displayName,vmType,
  depositEnabled,solverCurrencies[].{address,symbol,name,decimals}}`. We show a curated subset in
  this order: Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Mantle, Solana,
  Tron, Bitcoin — and only stable/major tokens per chain (USDC, USDT, ETH/WETH, native, BTC, SOL).
  Cached server-side 1 h.
- Deposit address: `POST https://api.relay.link/quote/v2` with
  `{ user: <refundTo>, originChainId, originCurrency, destinationChainId: 8453,
  destinationCurrency: <Base USDC>, amount: <a representative amount, e.g. $50 in origin units>,
  recipient: <the user's Stax smart account>, tradeType: "EXACT_INPUT", refundTo, useDepositAddress:
  true }` → `steps[0].depositAddress` (or the documented field), `requestId`, `fees`. Open (non-strict)
  addresses accept any amount and are reusable for the same route, so we store one per
  `(user, originChainId, originCurrency)` and hand it back next time.
- `refundTo` must be an address on the ORIGIN chain. EVM origins: the user's Privy embedded EOA
  (same address on every EVM chain). Non-EVM origins (Solana, Tron, Bitcoin): the sheet asks for a
  refund address on that network before generating (validated by a per-VM regex), stored on the row.
- Status: `GET https://api.relay.link/requests/v2?depositAddress=<addr>` → recent deposits with
  status (`pending|success|failure|refund`), amounts, tx hashes. Polled every 6 s while the sheet is
  open, and shown as a small history under the QR ("$25.00 arrived 2 min ago").
- Fees are Relay's; we add none. Minimum ≈ what covers Relay's fee on that route; show
  "Send at least about $5" and the fee line from the quote.

## Data — `web/src/lib/db/schema.ts` (agent `receive-server` owns the migration)

`deposit_addresses`: `id text pk`, `user_id fk users`, `chain text` (destination, 'base'),
`recipient text` (smart account), `origin_chain_id int`, `origin_currency text`, `origin_symbol text`,
`origin_vm text`, `refund_to text`, `address text unique`, `request_id text`, `created_at`,
`last_seen_at`. Unique `(user_id, chain, origin_chain_id, origin_currency)`.

## API (auth = Privy bearer; chain header = base)

- `GET /api/receive/networks` (public, `s-maxage=3600`) → `{ networks: [{ id, key, name, vm,
  tokens: [{ address, symbol, name, decimals }] }] }` (curated + ordered as above).
- `POST /api/receive/deposit-address` (auth, 30/min) body `{ originChainId, originCurrency,
  refundTo?: string }` → `{ address, originChainId, originCurrency, symbol, vm, minUsd, feeUsd,
  reusable: true, ownAddress: boolean }`. `recipient` is NEVER taken from the body: it is the caller's
  smart account from `ownedAddresses(userId).primary` (or the stored `smart_accounts` row). Base+USDC
  ⇒ `{ ownAddress: true, address: <recipient> }` without calling Relay. EVM origin ⇒ `refundTo` =
  the caller's embedded EOA from Privy (ignore body). Non-EVM ⇒ `refundTo` required + validated.
- `GET /api/receive/status?address=` (auth, 120/min, only for an address that belongs to the caller)
  → `{ deposits: [{ id, status, amountUsd, originTx, destinationTx, createdAt }] }`.

## UI (app design system, `WalletScreen` Receive sheet, Base only)

- Chooser sheet: three rows with icon, title, one-line hint; "Coming soon" tag on Add cash when
  gated. Back arrow inside each sub-flow returns to the chooser.
- **From another wallet**: `useConnectWallet` → shows the connected wallet's Base USDC balance,
  amount field with Max, "Move to Stax" → if the wallet is on another chain request a switch to
  Base; `transfer(recipient, amount)` on Base USDC signed by the external wallet (viem walletClient
  over `wallet.getEthereumProvider()`); success toast + balance refresh. Note under the button:
  "Your other wallet pays the network fee for this one."
- **From any network**: step 1 two dropdowns on one screen — Network (real logo + name) then Token
  (logo, symbol, name; enabled once a network is picked) — and Continue, (step 2 refund address for
  non-EVM), step 3 address card: QR, mono address with Copy, the warning
  line in the accent colour "Send only USDT on Tron to this address", the ETA line, the minimum, and
  the live deposit list. The address card is only shown after both picks so nobody deposits to the
  wrong network.
- Everything in the warm plain voice; no "bridge/solver" words on screen; 44px targets; dark parity.

## Ownership

| agent | owns |
|---|---|
| `receive-server` | schema + migration, `lib/server/relay.ts`, `lib/server/depositAddresses.ts`, the three routes, `.env.example` (`RELAY_API_URL` optional), `docs/INFRA.md` note, smoke case |
| `receive-ui` | `hooks/useReceive.ts`, `components/lite/receive/*` (Chooser, FromWallet, AnyNetwork, PickStep, Dropdown, RefundAddressStep, AddressCard, DepositHistory), the Receive wiring in `WalletScreen.tsx`, `lib/chainMarks.tsx` + `lib/tokenLogos.ts` (real network PNGs under `/icons/networks`, token SVGs under `/icons/tokens`) |
