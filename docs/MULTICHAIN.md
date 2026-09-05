# Stax multi-chain: Base first, Mantle kept

Base (chainId 8453) is the default network. Mantle (5000) stays as a second mode. The user
switches in Settings; the choice persists in `localStorage["stax.chain"]`.

## Single source of truth — `web/src/lib/chains/`

| File | What |
|---|---|
| `types.ts` | `StaxChain`, `Asset`, `AssetRoute`, `RouteHop`, `SwapVia`, `explorerTx()`, `explorerAddress()` |
| `base.ts` | Base config: Coinbase B20 stocks (8 dec), Uniswap V3 SwapRouter02 + QuoterV2, Aave v3 Pool (safe tier), cbBTC/WETH (crypto tier) |
| `mantle.ts` | Mantle config (unchanged addresses): Backed wrapped xStocks on Fluxion, Agni routes (mETH; sUSDe sell-only), FBTC gated |
| `index.ts` | `CHAINS`, `DEFAULT_CHAIN_KEY = "base"`, `CHAIN_HEADER = "x-stax-chain"`, `getChain(key)`, `isChainKey()`, `chainById()`, `assetBySymbol()`, `isRoutable(chain, symbol)`, `investableAssets(chain)`, `reverseRoute()` |
| `active.ts` | **client only.** `useChain()`, `useChainKey()`, `getActiveChain()`, `getActiveChainKey()`, `setActiveChainKey()` (external store + localStorage) |
| `../wagmi.ts` | `wagmiConfig` (both chains), `getPublicClient(chain)` cached read client per chain, `base`, `mantle` viem chains |
| `../server/chain.ts` | **server only.** `chainFromRequest(req)`, `chainKeyFromRequest(req)`, `serverClient(chain)` |

`web/src/lib/mantle.ts` is **deleted**. Everything that imported `USDC`, `STOCKS`, `ALL_ASSETS`,
`ASSET_ROUTES`, `FLUXION_ROUTER`, `MANTLE_CHAIN`, `MULTICALL3`, `INFERENCE_VERIFIER`, `isRoutable`,
`reverseRoute`, `publicClient`, `mantle` must now take a `StaxChain`:

| Old | New |
|---|---|
| `USDC` | `chain.usdc` (`.address`, `.decimals`) |
| `STOCKS` / `SAFE` / `CRYPTO` / `ALL_ASSETS` | `chain.assets.stocks` / `.safe` / `.crypto` / `.all` |
| `ASSET_ROUTES[sym]` | `chain.routes[sym]` |
| `FLUXION_ROUTER` | `chain.routers.v3` (+ `chain.routers.v3Kind` says which ABI: `"fluxion"` has `deadline`, `"uniswap_v3"` does not) |
| `MANTLE_CHAIN` / `mantle` | `chain.chain` (viem Chain), `chain.id`, `chain.name` |
| `MULTICALL3` | `chain.multicall3` (already in `chain.chain.contracts.multicall3`) |
| `INFERENCE_VERIFIER` | `chain.contracts.verifier` |
| `STAX_EXECUTOR` (legBuilder) | `chain.contracts.executor` |
| `NEXT_PUBLIC_IDENTITY_REGISTRY`, `_STAX_AGENT_ID`, `_STAX_EXECUTOR_BLOCK` env reads | `chain.contracts.registry`, `.agentId`, `.executorBlock` |
| `isRoutable(sym)` | `isRoutable(chain, sym)` |
| `publicClient` (client) | `getPublicClient(chain)` |
| Mantlescan URL strings | `explorerTx(chain, hash)` / `explorerAddress(chain, addr)` / `chain.explorer` |
| Etherscan V2 `chainid=5000` | `chain.etherscanChainId` |
| Pimlico `v2/5000/rpc` | `v2/${chain.id}/rpc` — proxy takes `?chain=` |
| EIP-712 `chainId: 5000` | `chain.id` + `chain.contracts.verifier` |

## How the chain reaches code

- **Client components/hooks:** `const chain = useChain()` from `@/lib/chains/active`. Non-React
  client modules (`aa.ts`, `authedFetch.ts`) use `getActiveChain()`.
- **API routes:** `const chain = chainFromRequest(req)` from `@/lib/server/chain`. `authedFetch`
  adds the `x-stax-chain` header automatically; `?chain=` query also works (used by the Pimlico
  proxy transport and cron).
- **Server libs** (`allocate.ts`, `marketData.ts`, `executorLogs.ts`, `walletTransfers.ts`,
  `autopilotExecutor.ts`, `legBuilder.ts`, `prices.ts`, `eip712.ts`): take `chain: StaxChain` as an
  explicit parameter. No module-level chain constants.
- **Autopilot:** the stored config carries `chain` (`base` | `mantle`, default `base`); the cron
  executor runs each config on its chain.

## Swap execution kinds (`Asset.via` / `chain.routers.v3Kind`)

| via | Buy (executor leg, recipient = executor) | Manual buy (recipient = user) | Sell |
|---|---|---|---|
| `fluxion` (Mantle) | `FLUXION_ROUTER_ABI.exactInputSingle` (has `deadline`) | same | same reversed |
| `agni` (Mantle) | `AGNI_ROUTER_ABI.exactInput(path)` (has `deadline`) | same | reversed path |
| `uniswap_v3` (Base) | `UNISWAP_ROUTER02_ABI.exactInputSingle` (**no `deadline`**) on `chain.routers.v3` | same | same reversed |
| `aave_v3` (Base) | `AAVE_POOL_ABI.supply(USDC, amt, executor, 0)` on `chain.routers.aavePool`, `tokenOut = aBasUSDC` | `supply(USDC, amt, user, 0)` | `withdraw(USDC, amt, user)` from the user's account (aToken balance is the USDC amount, 1:1, 6 dec) |

Quoting: on chains with `chain.routers.quoterV2` (Base), use `UNISWAP_QUOTER_V2_ABI` via
`simulateContract` for expected output (thin pools ⇒ real price impact). Fall back to the pool
`slot0` spot estimate (existing code) if the quoter call fails. `minOut = expected × (1 − slippage)`.
Aave: expected out = amountIn (1:1), minOut = amountIn − 1.

B20 stocks: `balanceOf` is raw 8-dec; `multiplier()` (WAD) converts to shares and is 1e18 today.
Chainlink feeds (`Asset.priceFeed`, `AGGREGATOR_V3_ABI`, 8 dec) give the reference market price
for display; the pool price is what a buy actually pays.

## Env (web/.env.example)

Base contracts (set after `contracts/scripts/deploy-base.js`):
`NEXT_PUBLIC_STAX_EXECUTOR_BASE`, `NEXT_PUBLIC_INFERENCE_VERIFIER_BASE`,
`NEXT_PUBLIC_IDENTITY_REGISTRY_BASE`, `NEXT_PUBLIC_STAX_AGENT_ID_BASE`,
`NEXT_PUBLIC_STAX_EXECUTOR_BLOCK_BASE`, `NEXT_PUBLIC_BASE_RPC_URL`.
Mantle keeps the existing names. Until Base contracts are set, `chain.contracts.deployed === false`
and the UI must show a calm "Base is being switched on" state instead of firing calls.

## Base liquidity snapshot (2026-09-05)

NVDAc fee 3000 $30k · GOOGLc fee 10000 $48k · SPCXc fee 10000 $30k · AAPLc fee 3000 $4k · METAc fee 3000 $1.5k.
TSLAc AMZNc MSFTc MSTRc: minted, no USDC pool yet (coming). COINc CRCLc INTCc: not minted.
cbBTC fee 500 $4.7M · WETH fee 500 $3.6M · Aave v3 USDC ~3.8% APY.
