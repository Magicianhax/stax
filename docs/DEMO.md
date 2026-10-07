# The demo (`/demo`)

Judges and first-time visitors can try Stax with no login and no money. It is the real app
(`LiteApp` and its screens) under `components/demo/DemoProvider.tsx`; every data hook reads that
context and answers from demo data when it is present. In `/app` the provider is absent and
nothing changes. The demo never signs, sends, or calls Binance (or any API of ours that does).

## What it shows

BNB Chain, the default network: a fictional account holding bStock and Ondo stocks (NVDA is held
from both issuers), a little BTCB, USDT cash and a small Venus Savings balance, with
BscScan-linked history. No fee line anywhere. Base is reachable only because gifts exist only there
(the app switches to it when a gift is opened, as in production); Mantle is not offered.

## Where things live

| Piece | File |
|---|---|
| Provider, per-network API, session `fills` | `components/demo/DemoProvider.tsx` |
| The market: clock, both issuers' state and price vs the real share, issuer board, price history, earnings, quotes, Binance check | `lib/demo/bscMarket.ts` |
| The account: holdings, Activity, wallet history, prices, Savings, cost basis, the visitor's session | `lib/demo/bscWorld.ts` |
| Vera: plans from stocks buyable now at >= $6 a leg, refusals, placing | `lib/demo/bscVera.ts` |
| Reference prices and day moves | `lib/demo/bscRef.ts` |
| Base world (unchanged) | `lib/demo/demoData.ts`, `lib/demo/world.ts` |
| Tests | `lib/demo/bscDemo.test.ts` |

All logic is plain `lib/` functions of a clock, so it is tested in Node.

## The market clock

`/demo` follows the viewer's own clock: on a weekend the market is closed, Vera refuses to plan
stocks and the buy button says "Market closed", which is the product. To see either story at any
hour: `/demo?market=open`, `/demo?market=closed`, or Settings > Demo market.

- open or before/after the bell: both issuers trade; overnight only Ondo does; weekend or holiday
  neither does. One pause: TSLA at bStock.
- price vs the real share: within about 0.3% while open; Ondo further above than bStock when shut;
  one discount while open (AMD at Ondo).

## Session behaviour

A buy, a sold position, a placed plan or a Savings move is kept in memory and shown on Home,
Owned, Activity and the wallet; a reload starts over. Receipts link to BscScan with made-up
hashes (they do not exist on chain).

## Other `?` options

`?mode=light|dark` (default dark), `?play=invest|vera` (scripted walkthroughs, unused on the landing).

## Landing phones

`public/brand/screens/{goal,plan,market}.png` are captures of this demo; see docs/LANDING.md.
