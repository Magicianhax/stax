"use client";

// Gifting — everything the gift screens need, so the components stay presentational.
//
//   useGiftsEnabled() is the contract live on this chain at all?
//   useGifts()        the two lists ("You sent" / "For you") + how many are ready
//   useSendGift()     collect → buy → park → recorded, with a phase the UI follows
//   useClaimGift()    the recipient opens it
//   useReclaimGift()  the giver takes an unclaimed one back
//
// Giving is two sponsored user ops, not one (docs/GIFTS.md, "Why the tokens are
// parked in a second transaction"): `StaxExecutor.investWithAI` forwards every
// bought token to `msg.sender`, so a gift cannot be bought straight into the gift
// contract. The exact amounts are only known once the first transaction lands, so
// they are read from its `LegFilled` events rather than from the USD weights.
//
// Demo mode (the /demo route and the landing phones) never touches the API or a
// chain: it reads the seeded gifts from demoData and mutates them in memory, so
// give / view / claim all work end to end without a login.
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { decodeEventLog, encodeFunctionData, parseUnits, type Log } from "viem";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { sendSponsoredCalls, type Call } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { authedFetch } from "@/lib/authedFetch";
import { useChain } from "@/lib/chains/active";
import type { StaxChain } from "@/lib/chains";
import { displayFor } from "@/lib/displayAssets";
import { ERC20_ABI, STAX_EXECUTOR_ABI } from "@/lib/abis";
import { STAX_TREASURY } from "@/lib/fees";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { DEMO_GIFTS } from "@/lib/demo/demoData";
import { giftShareUrl } from "@/components/lite/gift/giftFormat";
import {
  giftClaimCall,
  giftContractFor,
  giftCreateCalls,
  giftReclaimCall,
  splitGiftBasket,
  type ClaimAuthorisationResponse,
  type CreateGiftRequest,
  type CreateGiftResponse,
  type GiftSummary,
  type GiftToken,
  type GiftsListResponse,
} from "@/lib/gifts";
import type { InvestPlanResult } from "@/lib/invest-types";

export type { GiftSummary as Gift } from "@/lib/gifts";

/**
 * Where a send has got to. Two transactions, so two working phases:
 *   reserving  the server writes the pending row and hands back the allocation
 *   buying     user op 1 — the basket is bought into the giver's own account
 *   parking    user op 2 — the bought tokens move into the gift contract
 *   recording  the server re-reads the contract before it believes any of it
 */
export type GiftPhase = "idle" | "reserving" | "buying" | "parking" | "recording" | "done" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── demo store ────────────────────────────────────────────────────────────────
// A mutable copy of the seeds so a demo claim actually changes the row. Module
// scope on purpose: it must survive the route change from the sheet back to the list.
let demoStore: GiftSummary[] | null = null;
function demoGifts(): GiftSummary[] {
  if (!demoStore) demoStore = DEMO_GIFTS.map((g) => ({ ...g }));
  return demoStore;
}
function demoPatch(id: string, patch: Partial<GiftSummary>) {
  demoStore = demoGifts().map((g) => (g.id === id ? { ...g, ...patch } : g));
}

// ── API ───────────────────────────────────────────────────────────────────────

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json && typeof json.error === "string" ? json.error : "Something went wrong.");
  }
  return json as T;
}

const postJson = <T,>(url: string, body?: unknown) =>
  apiJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

// ── is gifting switched on here? ──────────────────────────────────────────────

/**
 * Until `NEXT_PUBLIC_STAX_GIFT_BASE` is set the contract does not exist,
 * `giftContractFor` returns null and every route answers 503 — so the entry
 * points stay hidden rather than leading somewhere that cannot work. The demo
 * never touches a contract, so it is always on.
 */
export function useGiftsEnabled(): boolean {
  const chain = useChain();
  const demo = useDemo();
  return demo !== null || giftContractFor(chain.key) !== null;
}

// ── lists ─────────────────────────────────────────────────────────────────────

export interface UseGifts {
  sent: GiftSummary[];
  received: GiftSummary[];
  /** Gifts for you that can be opened right now — the badge count. */
  claimableCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  byId: (id: string | undefined) => GiftSummary | undefined;
}

export function useGifts(): UseGifts {
  const demo = useDemo();
  const chain = useChain();
  const enabled = useGiftsEnabled();
  const qc = useQueryClient();

  const query = useQuery<GiftsListResponse>({
    queryKey: ["gifts", chain.key, demo ? "demo" : "live"],
    enabled,
    queryFn: async () => {
      if (demo) {
        const all = demoGifts();
        return {
          sent: all.filter((g) => g.direction === "sent"),
          received: all.filter((g) => g.direction === "received"),
        };
      }
      return apiJson<GiftsListResponse>("/api/gifts");
    },
    staleTime: 30_000,
  });

  // Memoised so an empty list isn't a new array on every render (which would
  // re-make `byId` and re-run every consumer's effects).
  const sent = useMemo(() => query.data?.sent ?? [], [query.data]);
  const received = useMemo(() => query.data?.received ?? [], [query.data]);
  const claimableCount = received.filter((g) => g.claimable).length;

  const byId = useCallback(
    (id: string | undefined) => (id ? [...sent, ...received].find((g) => g.id === id) : undefined),
    [sent, received],
  );

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["gifts"] });
  }, [qc]);

  return {
    sent,
    received,
    claimableCount,
    loading: enabled && query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
    byId,
  };
}

// ── send ──────────────────────────────────────────────────────────────────────

/** What the give flow hands over. `unlockAt` is unix seconds; the API wants ISO. */
export interface GiftDraft {
  basketId: string;
  amountUsd: number;
  recipientEmail: string;
  unlockAtSeconds: number;
  note?: string;
}

export interface SentGift {
  id: string;
  basketName: string;
  recipientEmailMasked: string;
  unlockAtIso: string;
  /** The tokens actually parked, read from the invest receipt. */
  tokens: GiftToken[];
  note: string;
  /** The link to hand over. Built by the server; never re-derived here. */
  shareUrl: string;
}

/**
 * The basket as the screen already knows it. Used ONLY by the demo, which has no
 * server to ask what `basketId` contains and no chain to buy it on. The real
 * path ignores it: what a gift holds is whatever the invest receipt says landed.
 */
export interface GiftDisplay {
  basketName: string;
  items: { symbol: string; weightPct: number }[];
}

export interface UseSendGift {
  phase: GiftPhase;
  error: string | null;
  /** The finished gift — the success screen shares its link. */
  sent: SentGift | null;
  send: (draft: GiftDraft, display?: GiftDisplay) => Promise<void>;
  reset: () => void;
}

/** Demo only: weights and dollars into plausible raw token amounts. */
function demoTokens(chain: StaxChain, items: GiftDisplay["items"], amountUsd: number): GiftToken[] {
  return items.map((i) => {
    const asset = chain.assets.all.find((a) => a.symbol === i.symbol);
    const decimals = asset?.decimals ?? 18;
    const price = displayFor(i.symbol).price ?? 1;
    const qty = (amountUsd * i.weightPct) / 100 / price;
    return {
      symbol: i.symbol,
      address: (asset?.address ?? "0x") as `0x${string}`,
      amount: parseUnits(qty.toFixed(Math.min(decimals, 8)), decimals).toString(),
    };
  });
}

/**
 * The bought amounts, from the invest transaction's `LegFilled(planId, tokenOut,
 * usdcIn, received)` events. Not from `minOut` and not from the USD weights —
 * each leg's output depends on the price at execution.
 */
function tokensFromReceipt(logs: readonly Log[], chain: StaxChain): GiftToken[] {
  const byAddress = new Map<string, bigint>();
  for (const log of logs) {
    try {
      const event = decodeEventLog({ abi: STAX_EXECUTOR_ABI, data: log.data, topics: log.topics });
      if (event.eventName !== "LegFilled") continue;
      const { tokenOut, received } = event.args as unknown as { tokenOut: `0x${string}`; received: bigint };
      const key = tokenOut.toLowerCase();
      // A plan can buy the same token in more than one leg; the contract wants
      // one row per address, so sum them.
      byAddress.set(key, (byAddress.get(key) ?? BigInt(0)) + received);
    } catch {
      // Not one of ours (ERC-20 Transfer, the paymaster, the entry point) — skip it.
    }
  }
  const tokens: GiftToken[] = [];
  for (const [address, amount] of byAddress) {
    if (amount <= BigInt(0)) continue;
    const asset = chain.assets.all.find((a) => a.address?.toLowerCase() === address);
    tokens.push({
      symbol: asset?.symbol ?? address,
      // The registry's checksummed address when we know it, so the approvals and
      // `create` name the token exactly as the rest of the app does.
      address: (asset?.address ?? address) as `0x${string}`,
      amount: amount.toString(),
    });
  }
  return tokens;
}

/**
 * Everything a gift parks: what the invest step bought, plus the safe slice held
 * as plain USDC. Folded by address so a duplicate can never be approved twice or
 * paid out twice.
 *
 * This mirrors the fold inside `giftCreateCalls`, and exists because the same
 * list has to reach two places — the contract call and the `funded` report the
 * server matches against it. Building it once and passing it to both is what
 * stops them disagreeing, so `cashToken` is folded in HERE and must not be
 * handed to `giftCreateCalls` as well.
 */
function mergeGiftTokens(tokens: GiftToken[], cashToken: GiftToken | null): GiftToken[] {
  const merged: GiftToken[] = [];
  for (const token of cashToken ? [...tokens, cashToken] : tokens) {
    const seen = merged.find((m) => m.address.toLowerCase() === token.address.toLowerCase());
    if (seen) seen.amount = (BigInt(seen.amount) + BigInt(token.amount)).toString();
    else merged.push({ ...token });
  }
  return merged;
}

export function useSendGift(): UseSendGift {
  const demo = useDemo();
  const chain = useChain();
  const wallet = useActiveWallet();
  const { address } = useSmartAccount();
  const qc = useQueryClient();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<GiftPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentGift | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setSent(null);
  }, []);

  const send = useCallback(
    async (draft: GiftDraft, display?: GiftDisplay) => {
      setError(null);
      const unlockAtIso = new Date(draft.unlockAtSeconds * 1000).toISOString();

      // Demo: walk the phases on a timer and add the gift to the seeded list.
      if (demo) {
        setPhase("reserving");
        await sleep(700);
        setPhase("buying");
        await sleep(1400);
        setPhase("parking");
        await sleep(1200);
        setPhase("recording");
        await sleep(600);
        const seed = demoGifts().find((g) => g.basketId === draft.basketId);
        const basketName = display?.basketName ?? seed?.basketName ?? "Your basket";
        // The demo splits the basket the same way the server does, so a Safe
        // Dollars slice shows up as parked cash here too rather than as an aToken.
        const split = display ? splitGiftBasket(chain.key, display.items, draft.amountUsd) : null;
        const tokens = split
          ? mergeGiftTokens(demoTokens(chain, split.invested, split.investUsd), split.cashToken)
          : (seed?.tokens ?? []);
        const id = `0x${Date.now().toString(16).padStart(64, "d")}`.slice(0, 66) as `0x${string}`;
        const masked = maskLocally(draft.recipientEmail);
        demoStore = [
          {
            id,
            chain: "base",
            direction: "sent",
            status: "funded",
            basketId: draft.basketId,
            basketName,
            amountUsd: draft.amountUsd,
            note: draft.note ?? null,
            unlockAt: unlockAtIso,
            reclaimAfter: new Date((draft.unlockAtSeconds + 90 * 86_400) * 1000).toISOString(),
            createdAt: new Date().toISOString(),
            tokens,
            holdings: split?.holdings ?? seed?.holdings ?? [],
            createTxHash: null,
            claimTxHash: null,
            recipientEmailMasked: masked,
            fromName: null,
            claimable: false,
            reclaimable: false,
            shareUrl: giftShareUrl(id),
          },
          ...demoGifts(),
        ];
        setSent({
          id,
          basketName,
          recipientEmailMasked: masked,
          unlockAtIso,
          tokens,
          note: draft.note ?? "",
          shareUrl: giftShareUrl(id),
        });
        setPhase("done");
        void qc.invalidateQueries({ queryKey: ["gifts"] });
        return;
      }

      try {
        if (!wallet || !address) throw new Error("No account found. Please sign in again.");

        // 1. Reserve the gift. Nothing is on-chain yet; this hands back the
        //    allocation to buy and the exact arguments `create` will need.
        setPhase("reserving");
        const body: CreateGiftRequest = {
          basketId: draft.basketId,
          amountUsd: draft.amountUsd,
          recipientEmail: draft.recipientEmail,
          unlockAt: unlockAtIso,
          note: draft.note,
        };
        const reserved = await postJson<CreateGiftResponse>("/api/gifts", body);

        // 2. Buy the investable part through the normal executor path. The tokens
        //    land in the giver's own smart account — the executor has no recipient.
        //
        //    `allocation` excludes any Aave "Safe Dollars" slice (that is parked as
        //    plain USDC instead, so 25 years of rebasing interest can't be stranded
        //    in the contract), and its weights are renormalised over what remains.
        //    So the amount sent here MUST be `investUsd`, not the gift's full
        //    `amountUsd` — sending the full amount would silently spend the cash
        //    slice's dollars on stocks with no error anywhere.
        const provider = asViemProvider(await wallet.getEthereumProvider());
        let tokens: GiftToken[] = [];

        if (reserved.allocation && reserved.investUsd > 0) {
        setPhase("buying");
        const plan = await postJson<InvestPlanResult>("/api/invest-plan", {
          address,
          allocation: reserved.allocation,
          amountUsd: reserved.investUsd,
        });
        if (plan.chain !== chain.key || plan.executor.toLowerCase() !== chain.contracts.executor.toLowerCase()) {
          throw new Error("That plan was built for a different network. Please try again.");
        }
        const usdcTotal = BigInt(plan.usdcTotal);
        const investCalls: Call[] = [];
        // The fee is skimmed on the invest leg only, so it is sized against
        // `investUsd`. The cash slice pays none.
        const feeRaw = BigInt(Math.round(reserved.investUsd * 1_000_000)) - usdcTotal;
        if (feeRaw > BigInt(0)) {
          investCalls.push({
            to: chain.usdc.address,
            data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [STAX_TREASURY, feeRaw] }),
          });
        }
        investCalls.push({
          to: chain.usdc.address,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [chain.contracts.executor, usdcTotal] }),
        });
        investCalls.push({
          to: chain.contracts.executor,
          data: encodeFunctionData({
            abi: STAX_EXECUTOR_ABI,
            functionName: "investWithAI",
            args: [
              {
                planId: plan.plan.planId,
                recHash: plan.plan.recHash,
                riskScore: plan.plan.riskScore,
                agentId: BigInt(plan.plan.agentId),
              },
              {
                assessedRisk: plan.inference.assessedRisk,
                maxRisk: plan.inference.maxRisk,
                expiry: BigInt(plan.inference.expiry),
                signature: plan.inference.signature,
              },
              plan.legs.map((l) => ({
                router: l.router,
                tokenOut: l.tokenOut,
                usdcIn: BigInt(l.usdcIn),
                minOut: BigInt(l.minOut),
                swapData: l.swapData,
              })),
              usdcTotal,
            ],
          }),
        });
        const investReceipt = await sendSponsoredCalls(provider, investCalls, chain);

        // 3. What actually got bought, from the receipt's own events.
        tokens = tokensFromReceipt(investReceipt.receipt.logs, chain);
        if (tokens.length === 0) {
          throw new Error("The basket was bought, but we couldn't read what landed. Check your holdings before trying again.");
        }
        }

        // 4. Everything that gets parked: what was bought, plus the cash slice.
        //    Merged once here and used for BOTH the contract call and the report
        //    to the server, so the two can never disagree about what was parked.
        const parked = mergeGiftTokens(tokens, reserved.cashToken);
        if (parked.length === 0) {
          throw new Error("There was nothing to put aside. Nothing has been taken — please try again.");
        }

        // 5. Park them against the recipient's hash.
        setPhase("parking");
        const parkReceipt = await sendSponsoredCalls(
          provider,
          giftCreateCalls({
            giftContract: reserved.giftContract,
            giftId: reserved.giftId,
            recipientHash: reserved.recipientHash,
            unlockAt: reserved.unlockAt,
            reclaimAfter: reserved.reclaimAfter,
            // Already merged above, so the cash slice must NOT be passed again
            // here — giftCreateCalls would fold it in a second time.
            tokens: parked,
            note: reserved.note,
          }),
          chain,
        );

        // 6. Tell the server, which re-reads the contract before believing it.
        //    The body must list exactly what the contract holds, cash row included.
        setPhase("recording");
        await postJson(`/api/gifts/${reserved.giftId}/funded`, {
          txHash: parkReceipt.receipt.transactionHash,
          tokens: parked,
        });

        setSent({
          id: reserved.giftId,
          basketName: reserved.basketName,
          recipientEmailMasked: reserved.recipientEmailMasked,
          unlockAtIso: reserved.unlockAtIso,
          tokens: parked,
          note: reserved.note,
          shareUrl: reserved.shareUrl,
        });
        setPhase("done");
        void qc.invalidateQueries({ queryKey: ["gifts"] });
        refreshBalances();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The gift didn't go through.");
        setPhase("error");
      }
    },
    [demo, chain, wallet, address, qc, refreshBalances],
  );

  return { phase, error, sent, send, reset };
}

/** Local mask for the demo, which has no server to do it. */
function maskLocally(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at <= 0 ? "•••" : `${e.slice(0, 1)}•••@${e.slice(at + 1)}`;
}

// ── claim / reclaim ───────────────────────────────────────────────────────────

function useGiftSettlement(kind: "claim" | "reclaim") {
  const demo = useDemo();
  const chain = useChain();
  const wallet = useActiveWallet();
  const qc = useQueryClient();
  const refreshBalances = useRefreshBalances();

  return useMutation({
    mutationFn: async (id: `0x${string}`) => {
      if (demo) {
        await sleep(1100);
        demoPatch(id, { status: kind === "claim" ? "claimed" : "reclaimed", claimable: false, reclaimable: false });
        return;
      }
      const giftContract = giftContractFor(chain.key);
      if (!giftContract) throw new Error(`Gifting isn't switched on for ${chain.name} yet.`);
      if (!wallet) throw new Error("No account found. Please sign in again.");
      const provider = asViemProvider(await wallet.getEthereumProvider());

      // Claiming needs the server's attestation that this signed-in person owns
      // the email the gift was addressed to; taking one back needs nothing but
      // being the giver, which the contract checks itself.
      const call =
        kind === "claim"
          ? giftClaimCall(await postJson<ClaimAuthorisationResponse>(`/api/gifts/${id}/claim-authorisation`))
          : giftReclaimCall(giftContract, id);

      const receipt = await sendSponsoredCalls(provider, [call], chain);
      await postJson(`/api/gifts/${id}/claimed`, { txHash: receipt.receipt.transactionHash });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["gifts"] });
      refreshBalances();
    },
  });
}

/** The recipient opens a gift: the holdings move into their account. */
export function useClaimGift() {
  return useGiftSettlement("claim");
}

/** The giver takes an unclaimed gift back, once the wait is over. */
export function useReclaimGift() {
  return useGiftSettlement("reclaim");
}
