"use client";

// Receive — data + actions for the three ways money comes in (docs/RECEIVE.md), on
// whichever chain is active (Base's USDC or BSC's USDT is the destination cash asset).
// Everything the sheet needs lives here so the components stay presentational:
//
//   useReceiveNetworks()          curated networks + tokens (GET /api/receive/networks)
//   useDepositAddress()           mutation → one reusable address per network+token
//   useDepositStatus(address)     live deposit rows, polled every 6 s while a card is open
//   useExternalWalletTransfer()   "From another wallet": connect, read USDC on Base, move it
//
// Demo mode (the /demo route and landing phones) never touches the API or a
// chain: it returns a static network list, a canned address and canned rows so
// the whole flow is previewable without a login.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnectWallet, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import { createWalletClient, custom, parseUnits, type Hex } from "viem";
import { authedFetch } from "@/lib/authedFetch";
import { ERC20_ABI } from "@/lib/abis";
import { BASE } from "@/lib/chains/base";
import { useChain } from "@/lib/chains/active";
import { builderCodeSuffix } from "@/lib/builderCode";
import { getPublicClient } from "@/lib/wagmi";
import { fromUnits } from "@/lib/format";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { asViemProvider } from "@/lib/provider";
import type {
  DepositAddressResponse,
  DepositRow,
  DepositStatusResponse,
  NetworksResponse,
  ReceiveNetwork,
  ReceiveToken,
  ReceiveVm,
} from "@/lib/receive";

export type { DepositAddressResponse, DepositRow, ReceiveNetwork, ReceiveToken, ReceiveVm };
export { isValidRefundAddress } from "@/lib/receive";

// ── Demo fixtures ─────────────────────────────────────────────────────────────

const DEMO_NETWORKS: ReceiveNetwork[] = [
  { id: 8453, key: "base", name: "Base", vm: "evm", tokens: [
    { address: BASE.usdc.address, symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", name: "Ether", decimals: 18 },
  ] },
  { id: 1, key: "ethereum", name: "Ethereum", vm: "evm", tokens: [
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", name: "Tether USD", decimals: 6 },
    { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", name: "Ether", decimals: 18 },
  ] },
  { id: 42161, key: "arbitrum", name: "Arbitrum", vm: "evm", tokens: [
    { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", name: "Ether", decimals: 18 },
  ] },
  { id: 10, key: "optimism", name: "Optimism", vm: "evm", tokens: [
    { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", name: "Ether", decimals: 18 },
  ] },
  { id: 137, key: "polygon", name: "Polygon", vm: "evm", tokens: [
    { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", name: "Tether USD", decimals: 6 },
  ] },
  { id: 56, key: "bsc", name: "BNB Chain", vm: "evm", tokens: [
    { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "Tether USD", decimals: 18 },
    { address: "0x0000000000000000000000000000000000000000", symbol: "BNB", name: "BNB", decimals: 18 },
  ] },
  { id: 43114, key: "avalanche", name: "Avalanche", vm: "evm", tokens: [
    { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x0000000000000000000000000000000000000000", symbol: "AVAX", name: "Avalanche", decimals: 18 },
  ] },
  { id: 5000, key: "mantle", name: "Mantle", vm: "evm", tokens: [
    { address: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE", symbol: "USDT", name: "Tether USD", decimals: 6 },
  ] },
  { id: 792703809, key: "solana", name: "Solana", vm: "svm", tokens: [
    { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "11111111111111111111111111111111", symbol: "SOL", name: "Solana", decimals: 9 },
  ] },
  { id: 728126428, key: "tron", name: "Tron", vm: "tvm", tokens: [
    { address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", symbol: "USDT", name: "Tether USD", decimals: 6 },
  ] },
  { id: 8253038, key: "bitcoin", name: "Bitcoin", vm: "bvm", tokens: [
    { address: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", symbol: "BTC", name: "Bitcoin", decimals: 8 },
  ] },
];

const DEMO_DEPOSIT_ADDRESS: Record<ReceiveVm, string> = {
  evm: "0x7a3f0c5d9e2b4a6c8f1d3e5b7a9c2e4f6d8b0a1c",
  svm: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  tvm: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
  bvm: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
};

function demoDeposits(): DepositRow[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    { id: "d1", status: "pending", amountUsd: 40, originTx: null, destinationTx: null, createdAt: now - 45 },
    { id: "d2", status: "success", amountUsd: 25, originTx: "0xabc", destinationTx: "0xdef", createdAt: now - 2 * 60 },
    { id: "d3", status: "success", amountUsd: 120.5, originTx: "0x123", destinationTx: "0x456", createdAt: now - 3 * 86_400 },
  ];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.json()) as { error?: unknown };
    if (typeof json?.error === "string" && json.error.trim()) return json.error;
  } catch {
    /* non-JSON body */
  }
  return fallback;
}

// ── Networks ──────────────────────────────────────────────────────────────────

/** Curated networks + tokens for "From any network", in the doc's order. */
export function useReceiveNetworks() {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["receive-networks"],
    enabled: !demo,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    queryFn: async (): Promise<ReceiveNetwork[]> => {
      const res = await authedFetch("/api/receive/networks");
      if (!res.ok) throw new Error(await readError(res, "Couldn't load the list of networks."));
      const json = (await res.json()) as NetworksResponse;
      return json.networks;
    },
  });
  if (demo) return { ...query, data: DEMO_NETWORKS, isLoading: false, isPending: false, isError: false, error: null } as typeof query;
  return query;
}

// ── Deposit address ───────────────────────────────────────────────────────────

export interface DepositAddressInput {
  originChainId: number;
  originCurrency: string;
  /** Required for non-EVM origins; ignored (server uses the embedded EOA) for EVM. */
  refundTo?: string;
  /** For the demo / optimistic labelling only — the server answers with its own copy. */
  symbol?: string;
  vm?: ReceiveVm;
}

/** POST /api/receive/deposit-address → the address card payload. Reusable per (network, token). */
export function useDepositAddress() {
  const demo = useDemo();
  const chain = useChain();
  return useMutation({
    mutationFn: async (input: DepositAddressInput): Promise<DepositAddressResponse> => {
      if (demo) {
        await sleep(600);
        // The active chain's own cash asset landing on the chain itself needs no bridge —
        // true for Base + USDC and equally for BSC + USDT, so this checks the live chain
        // rather than hardcoding Base.
        const own = input.originChainId === chain.id && input.originCurrency.toLowerCase() === chain.usdc.address.toLowerCase();
        const vm = input.vm ?? "evm";
        return {
          address: own ? demo.address : DEMO_DEPOSIT_ADDRESS[vm],
          originChainId: input.originChainId,
          originCurrency: input.originCurrency,
          symbol: input.symbol ?? chain.usdc.symbol,
          vm,
          minUsd: own ? 0 : 5,
          feeUsd: own ? 0 : 0.8,
          reusable: true,
          ownAddress: own,
        };
      }
      const res = await authedFetch("/api/receive/deposit-address", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originChainId: input.originChainId,
          originCurrency: input.originCurrency,
          ...(input.refundTo ? { refundTo: input.refundTo } : {}),
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't get an address right now. Try again in a moment."));
      return (await res.json()) as DepositAddressResponse;
    },
  });
}

// ── Status polling ────────────────────────────────────────────────────────────

/**
 * Recent deposits to `address`. Polls every 6 s while `enabled` (the card is
 * open) and stops the moment it closes. Never polls in demo.
 */
export function useDepositStatus(address: string | undefined, enabled: boolean) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["receive-status", address],
    enabled: !demo && Boolean(address) && enabled,
    refetchInterval: enabled ? 6_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
    queryFn: async (): Promise<DepositRow[]> => {
      const res = await authedFetch(`/api/receive/status?address=${encodeURIComponent(address as string)}`);
      if (!res.ok) throw new Error(await readError(res, "Couldn't check for deposits."));
      const json = (await res.json()) as DepositStatusResponse;
      return json.deposits;
    },
  });
  const demoRows = useMemo(() => (demo ? demoDeposits() : undefined), [demo]);
  if (demo) return { ...query, data: demoRows, isLoading: false, isPending: false, isError: false, error: null } as typeof query;
  return query;
}

/** Invalidate the deposit rows for one address (after a successful move, for instance). */
export function useRefreshDepositStatus() {
  const qc = useQueryClient();
  return useCallback((address?: string) => {
    qc.invalidateQueries({ queryKey: address ? ["receive-status", address] : ["receive-status"] });
  }, [qc]);
}

// ── From another wallet ───────────────────────────────────────────────────────

export type ExternalTransferPhase = "idle" | "switching" | "confirming" | "sending" | "done" | "error";

const BASE_CAIP = `eip155:${BASE.id}`;
// Canned receipt hash for demo-mode moves (never broadcast).
const DEMO_TX = ("0x" + "6a1f3c9e".repeat(8)) as Hex;
const DEMO_EXTERNAL: { address: string; name: string; usdc: number } = {
  address: "0x9f2c4b7e1d3a5c6f8b0e2d4a6c8e0f1b3d5a7c9e",
  name: "MetaMask",
  usdc: 312.4,
};

function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number; name?: string; message?: string; cause?: { code?: number } };
  if (err?.code === 4001 || err?.cause?.code === 4001) return true;
  if (err?.name === "UserRejectedRequestError") return true;
  const msg = (err?.message ?? "").toLowerCase();
  return msg.includes("user rejected") || msg.includes("user denied") || msg.includes("rejected the request");
}

function plainError(e: unknown, phase: ExternalTransferPhase): string {
  if (isUserRejection(e)) return "You cancelled it in your other wallet. Nothing moved.";
  const msg = e instanceof Error ? e.message.toLowerCase() : "";
  if (phase === "switching" || msg.includes("chain") && msg.includes("switch")) {
    return "Switch your other wallet to Base, then try again.";
  }
  if (msg.includes("insufficient") || msg.includes("exceeds balance") || msg.includes("transfer amount exceeds")) {
    return "Not enough USDC in that wallet for this amount.";
  }
  if (msg.includes("gas") || msg.includes("fee")) {
    return "That wallet needs a little ETH on Base to pay the network fee.";
  }
  return "Something went wrong moving the money. Nothing was taken. Try again in a moment.";
}

export interface ExternalWalletTransfer {
  /** The connected external wallet (not the embedded Stax one), if any. */
  wallet: ConnectedWallet | undefined;
  walletName: string | undefined;
  walletAddress: string | undefined;
  /** USDC balance of that wallet on Base (dollars), undefined while loading. */
  balance: number | undefined;
  balanceLoading: boolean;
  /** True when the wallet's current chain is not Base — the move switches it first. */
  needsSwitch: boolean;
  phase: ExternalTransferPhase;
  error: string | null;
  txHash: Hex | null;
  connect: () => void;
  /** Move `amount` dollars of USDC from the external wallet to `recipient` (the smart account). Resolves true on success. */
  move: (amount: number, recipient: `0x${string}`) => Promise<boolean>;
  reset: () => void;
}

export function useExternalWalletTransfer(): ExternalWalletTransfer {
  const demo = useDemo();
  const { wallets } = useWallets();
  const { connectWallet } = useConnectWallet();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<ExternalTransferPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [demoConnected, setDemoConnected] = useState(false);
  const [demoBalance, setDemoBalance] = useState(DEMO_EXTERNAL.usdc);

  // Any wallet Privy can see that is NOT the embedded one: an extension or a
  // WalletConnect session the person chose in the connect modal.
  const wallet = useMemo(
    () => wallets.find((w) => w.walletClientType !== "privy" && w.type === "ethereum"),
    [wallets],
  );
  const walletAddress = demo ? (demoConnected ? DEMO_EXTERNAL.address : undefined) : wallet?.address;
  const walletName = demo ? (demoConnected ? DEMO_EXTERNAL.name : undefined) : wallet?.meta?.name;

  const balanceQuery = useQuery({
    queryKey: ["external-usdc-balance", BASE.key, walletAddress],
    enabled: !demo && Boolean(walletAddress),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<number> => {
      const raw = (await getPublicClient(BASE).readContract({
        address: BASE.usdc.address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [walletAddress as `0x${string}`],
      })) as bigint;
      return fromUnits(raw, BASE.usdc.decimals);
    },
  });

  // Reset action state when the connected wallet changes.
  const lastAddr = useRef(walletAddress);
  useEffect(() => {
    if (lastAddr.current !== walletAddress) {
      lastAddr.current = walletAddress;
      setPhase("idle");
      setError(null);
      setTxHash(null);
    }
  }, [walletAddress]);

  const connect = useCallback(() => {
    if (demo) {
      setDemoConnected(true);
      return;
    }
    connectWallet();
  }, [demo, connectWallet]);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTxHash(null);
  }, []);

  const move = useCallback(
    async (amount: number, recipient: `0x${string}`): Promise<boolean> => {
      setError(null);
      setTxHash(null);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError("Enter an amount to move.");
        setPhase("error");
        return false;
      }
      const amountRaw = parseUnits(amount.toFixed(BASE.usdc.decimals), BASE.usdc.decimals);

      if (demo) {
        if (amount > demoBalance) {
          setError("Not enough USDC in that wallet for this amount.");
          setPhase("error");
          return false;
        }
        setPhase("confirming");
        await sleep(900);
        setPhase("sending");
        await sleep(1200);
        setDemoBalance((b) => Math.max(0, b - amount));
        setTxHash(DEMO_TX);
        setPhase("done");
        return true;
      }

      if (!wallet) {
        setError("Connect a wallet first.");
        setPhase("error");
        return false;
      }
      const bal = balanceQuery.data;
      if (bal !== undefined && amount > bal + 1e-9) {
        setError("Not enough USDC in that wallet for this amount.");
        setPhase("error");
        return false;
      }

      let step: ExternalTransferPhase = "switching";
      try {
        // 1. Make sure the external wallet is on Base (8453). Privy's helper
        //    asks the wallet to switch (or add) the chain; a fresh provider is
        //    needed afterwards, so we only fetch it once the switch settled.
        if (wallet.chainId !== BASE_CAIP) {
          setPhase("switching");
          await wallet.switchChain(BASE.id);
        }

        // 2. viem wallet client over the wallet's own EIP-1193 provider. The
        //    external wallet signs and pays gas itself (it is not our 4337 account).
        step = "confirming";
        setPhase("confirming");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const client = createWalletClient({
          account: wallet.address as `0x${string}`,
          chain: BASE.chain,
          transport: custom(provider),
        });

        // 3. USDC.transfer(recipient, amount) — plain ERC-20 move, no approval needed.
        //    The ERC-8021 tag rides along here too: this is the one transaction the
        //    app builds that the person's own wallet signs and pays for, and it is
        //    still volume the app caused. USDC ignores the trailing bytes the way
        //    every Solidity dispatcher does, and they cost the sender a few hundred
        //    gas. Undefined when no builder code is configured, which viem treats
        //    as no suffix at all.
        const hash = await client.writeContract({
          address: BASE.usdc.address,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [recipient, amountRaw],
          dataSuffix: builderCodeSuffix(BASE.key) ?? undefined,
        });
        setTxHash(hash);

        // 4. Wait for inclusion on Base via our read client, then refresh money reads.
        step = "sending";
        setPhase("sending");
        const receipt = await getPublicClient(BASE).waitForTransactionReceipt({ hash, confirmations: 1 });
        if (receipt.status !== "success") throw new Error("The network rejected the transfer.");
        setPhase("done");
        refreshBalances();
        void balanceQuery.refetch();
        return true;
      } catch (e) {
        setError(plainError(e, step));
        setPhase("error");
        return false;
      }
    },
    [demo, demoBalance, wallet, balanceQuery, refreshBalances],
  );

  return {
    wallet,
    walletName,
    walletAddress,
    balance: demo ? (demoConnected ? demoBalance : undefined) : balanceQuery.data,
    balanceLoading: demo ? false : Boolean(walletAddress) && balanceQuery.isPending,
    needsSwitch: !demo && Boolean(wallet) && wallet?.chainId !== BASE_CAIP,
    phase,
    error,
    txHash,
    connect,
    move,
    reset,
  };
}
