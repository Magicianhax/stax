"use client";

// Resolves the user's smart-account (ERC-4337) address — the address that
// actually holds funds and executes invests, NOT the Privy EOA owner.
// This is the address we show, fund, and read balances for.
import { useEffect, useRef, useState } from "react";
import { getSmartAccountClient } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { useDemo } from "@/components/demo/DemoProvider";
import { useActiveWallet } from "@/hooks/useActiveWallet";

export function useSmartAccount() {
  const demo = useDemo();
  const wallet = useActiveWallet();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Privy's useWallets() hands back a fresh `wallets` array (and wallet objects)
  // on many internal updates, so `wallet` is a new reference almost every render.
  // Keying the derivation on that object made this effect re-run constantly —
  // toggling loading/address and flickering the balance. Key on the STABLE owner
  // address instead (only re-derive when the user/wallet actually changes), and
  // read the latest wallet object through a ref.
  const ownerAddress = wallet?.address;
  const walletRef = useRef(wallet);
  useEffect(() => {
    walletRef.current = wallet;
  });

  useEffect(() => {
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
        const { account } = await getSmartAccountClient(provider);
        if (!cancelled) setAddress(account.address as `0x${string}`);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load your account.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ownerAddress]);

  if (demo) return { address: demo.address, loading: false, error: null };
  return { address, loading, error };
}
