// What a wallet transfer means to the person, in plain words. The Wallet screen used to recognise
// one thing: cash sent to the Stax executor, "Invested in a plan". On BNB Chain a plan (or a manual
// buy) goes from the person's own account to the Binance router, and a Savings deposit goes to the
// Venus vault, so both read "Sent USDT" to an unknown address, which looks like money leaving.
import type { StaxChain } from "./chains/types";
import { VENUS_VUSDT_ADDRESS } from "./execution";

export type WalletTxKind = "executor_invest" | "router_buy" | "router_sale" | "savings_in" | "savings_out" | "plain";

interface TxLike {
  direction: "in" | "out";
  counterparty: string;
  symbol: string;
}

export function walletTxKind(chain: StaxChain, t: TxLike): WalletTxKind {
  const who = t.counterparty.toLowerCase();
  if (t.direction === "out" && who === chain.contracts.executor.toLowerCase()) return "executor_invest";
  if (chain.key !== "bsc") return "plain";
  if (who === VENUS_VUSDT_ADDRESS.toLowerCase()) return t.direction === "out" ? "savings_in" : "savings_out";
  const router = chain.routers.binance?.toLowerCase();
  if (router && who === router && t.direction === "out") return t.symbol === chain.usdc.symbol ? "router_buy" : "router_sale";
  return "plain";
}

/** The row's headline. */
export function walletTxTitle(kind: WalletTxKind, t: TxLike): string {
  switch (kind) {
    case "executor_invest":
      return "Invested in a plan";
    case "router_buy":
      return "Invested";
    case "router_sale":
      return `Sold ${t.symbol}`;
    case "savings_in":
      return "Moved to Savings";
    case "savings_out":
      return "Moved back from Savings";
    default:
      return `${t.direction === "in" ? "Received" : "Sent"} ${t.symbol}`;
  }
}

/** The detail sheet's "who" row: its label and value, or null to keep the default counterparty row. */
export function walletTxParty(kind: WalletTxKind): { label: string; value: string } | null {
  switch (kind) {
    case "executor_invest":
      return { label: "Placed by", value: "Vera · Stax executor" };
    case "router_buy":
    case "router_sale":
      return { label: "Through", value: "Binance, from your account" };
    case "savings_in":
    case "savings_out":
      return { label: "With", value: "Venus Savings" };
    default:
      return null;
  }
}

/** Kinds that read as putting money to work (the spark icon and "Invested" detail title). */
export function isInvestKind(kind: WalletTxKind): boolean {
  return kind === "executor_invest" || kind === "router_buy";
}
