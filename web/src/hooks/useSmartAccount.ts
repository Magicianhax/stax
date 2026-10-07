"use client";

// Resolves the user's smart-account (ERC-4337) address on the ACTIVE chain —
// the address that actually holds funds and executes invests, NOT the Privy EOA
// owner. This is the address we show, fund, and read balances for.
//
// SimpleAccount v0.7 derives the same address on every chain for the same owner
// + salt, but we still re-derive per chain (and invalidate on switch) so the
// per-chain client wiring in lib/aa.ts is warmed up for the network in use.
import { useEffect, useRef, useState } from "react";
import { getSmartAccountClient } from "@/lib/aa";
import { authedFetch } from "@/lib/authedFetch";
import { asViemProvider } from "@/lib/provider";
import { useChain } from "@/lib/chains/active";
import { useDemo } from "@/components/demo/DemoProvider";
import { useActiveWallet } from "@/hooks/useActiveWallet";

/**
 * Tell the server which smart account this user trades from on `chain`, once per
 * (chain, address) per browser session. Fire-and-forget: the UI never waits on it,
 * and a failure only means /api/swap-quote can't verify `sender` yet (it warns).
 */
const registered = new Set<string>();
function registerSmartAccount(chain: string, owner: `0x${string}`, address: `0x${string}`) {
  const key = `${chain}:${address.toLowerCase()}`;
  if (registered.has(key)) return;
  registered.add(key);
  void authedFetch("/api/me/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chain, owner, address }),
  })
    .then((r) => {
      if (!r.ok) registered.delete(key); // retry on the next derivation
    })
    .catch(() => registered.delete(key));
}

export function useSmartAccount() {
  const demo = useDemo();
  const chain = useChain();
  const wallet = useActiveWallet();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Privy's useWallets() hands back a fresh `wallets` array (and wallet objects)
  // on many internal updates, so `wallet` is a new reference almost every render.
  // Keying the derivation on that object made this effect re-run constantly —
  // toggling loading/address and flickering the balance. Key on the STABLE owner
  // address + chain key instead (only re-derive when the user/wallet/network
  // actually changes), and read the latest wallet object through a ref.
  const ownerAddress = wallet?.address;
  const walletRef = useRef(wallet);
  useEffect(() => {
    walletRef.current = wallet;
  });

  const inDemo = demo !== null;
  useEffect(() => {
    // The demo has no real wallet: never derive or register an account (no POST /api/me/account).
    if (inDemo) return;
    let cancelled = false;
    (async () => {
      const w = walletRef.current;
      if (!w) {
        if (!cancelled) {
          setAddress(null);
          setError(null);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
      try {
        const provider = asViemProvider(await w.getEthereumProvider());
        const { account } = await getSmartAccountClient(provider, chain);
        if (!cancelled) {
          const smart = account.address as `0x${string}`;
          setAddress(smart);
          registerSmartAccount(chain.key, w.address as `0x${string}`, smart);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load your account.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ownerAddress, chain, inDemo]);

  if (demo) return { address: demo.address, loading: false, error: null, chain };
  return { address, loading, error, chain };
}
