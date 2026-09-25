// BNB Smart Chain mainnet (chainId 56). Tokenized stocks are issued by bStock and Ondo and
// traded through the Binance Web3 DEX aggregator, which returns unsigned router calldata
// (docs/BINANCE-WEB3.md §4). Cash is USDT, 18 decimals.
import { bsc as bscViem } from "viem/chains";
import { defineChain, zeroAddress } from "viem";
import { BSC_ASSETS } from "./bsc.assets";
import { BSC_CONTRACTS } from "./bsc.contracts";
import type { StaxChain } from "./types";

// Primary RPC: set NEXT_PUBLIC_BSC_RPC_URL to a keyed endpoint. The public endpoints below are
// rotated in on errors or rate limits (viem `fallback`).
const RPC_URL = process.env.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const RPC_FALLBACKS = ["https://bsc-dataseed1.binance.org", "https://bsc-rpc.publicnode.com"].filter((u) => u !== RPC_URL);
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/** The Binance Web3 aggregator router: both `quote.approveTarget` and `swap.tx.to`. */
export const BINANCE_ROUTER = "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5" as const;
export const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as const;

export const bscChain = defineChain({
  ...bscViem,
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { ...bscViem.contracts, multicall3: { address: MULTICALL3 } },
});

export const BSC: StaxChain = {
  key: "bsc",
  id: 56,
  name: "BNB Chain",
  chain: bscChain,
  rpcUrl: RPC_URL,
  rpcFallbacks: RPC_FALLBACKS,
  explorer: { name: "BscScan", url: "https://bscscan.com" },
  etherscanChainId: 56,
  nativeSymbol: "BNB",
  usdc: { address: BSC_USDT, symbol: "USDT", decimals: 18 },
  multicall3: MULTICALL3,
  contracts: BSC_CONTRACTS,
  routers: {
    // No single-hop V3 router: every BSC buy goes through the Binance aggregator.
    v3: zeroAddress,
    v3Kind: "none",
    binance: BINANCE_ROUTER,
    all: [BINANCE_ROUTER],
  },
  assets: BSC_ASSETS,
  routes: {},
  // The official BNB mark (Trust Wallet asset, same file NetworkMark already uses for BSC
  // deposits — lib/chainMarks.tsx), not the hand-drawn placeholder that used to live at
  // /chains/bsc.svg.
  brand: { tagline: "on BNB Chain", logo: "/icons/networks/bnb.png", accent: "#F0B90B" },
  issuer: "Tokenized stocks on BNB Chain are issued by bStock and Ondo, not by Stax.",
};
