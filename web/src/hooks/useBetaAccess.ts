"use client";

// Private-beta access, the single client source (docs/BETA.md).
//
//   useBetaAccess()  GET /api/me/access for the signed-in Privy user, keyed by
//                    user id. Refetches on window focus and polls every 60 s
//                    while the person is waiting, so an approval flips the
//                    gate without a reload. Never runs in demo mode.
//   useBetaJoin()    joins the list once when access says `status: "none"`:
//                    POST /api/beta/join with the smart-account address if it
//                    resolves within ~2 s, else the owner wallet, plus the
//                    stored `?ref=`. Writes the returned Access into the cache.
//   useBetaStats()   the public counts for the landing/beta page.
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { authedFetch } from "@/lib/authedFetch";
import { clearRef, getRef } from "@/lib/referral";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useDemo } from "@/components/demo/DemoProvider";
import { isBetaOn, type Access, type BetaStats } from "@/lib/beta";

export { isBetaOn, type Access, type BetaStats };

const accessKey = (userId: string | null) => ["beta-access", userId ?? "anon"] as const;

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      // body wasn't JSON
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function useBetaAccess(): {
  access: Access | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { ready, authenticated, user } = usePrivy();
  const demo = useDemo();
  const userId = user?.id ?? null;
  const enabled = ready && authenticated && !!userId && !demo;

  const q = useQuery({
    queryKey: accessKey(userId),
    enabled,
    staleTime: 15_000,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && d.beta && d.status === "waiting" ? 60_000 : false;
    },
    queryFn: async (): Promise<Access> =>
      readJson<Access>(await authedFetch("/api/me/access", { cache: "no-store" })),
  });

  return {
    access: q.data ?? null,
    loading: enabled && q.isPending,
    error: q.error ? q.error.message : null,
    refresh: () => {
      void q.refetch();
    },
  };
}

const SMART_ACCOUNT_WAIT_MS = 2000;

export function useBetaJoin(
  access: Access | null,
  opts: {
    /** Reads the hidden honeypot field on the page; a filled value is sent and the server rejects it. */
    honeypot?: () => string;
  } = {},
): {
  joining: boolean;
  joinError: string | null;
  retryJoin: () => void;
} {
  const qc = useQueryClient();
  const { user } = usePrivy();
  const demo = useDemo();
  const wallet = useActiveWallet();
  const { address: smart } = useSmartAccount();
  const userId = user?.id ?? null;

  // Privy hands back a fresh wallet object most renders; read it through a ref
  // so it never re-arms the join effect.
  const walletRef = useRef(wallet);
  useEffect(() => {
    walletRef.current = wallet;
  });
  const honeypotRef = useRef(opts.honeypot);
  useEffect(() => {
    honeypotRef.current = opts.honeypot;
  });

  const mutation = useMutation({
    mutationFn: async (address: string | undefined): Promise<Access> => {
      const ref = getRef();
      const website = honeypotRef.current?.() || undefined;
      return readJson<Access>(
        await authedFetch("/api/beta/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address, ref: ref ?? undefined, website }),
        }),
      );
    },
    onSuccess: (data) => {
      clearRef();
      qc.setQueryData(accessKey(userId), data);
    },
  });

  // One join per signed-in user. If the smart account is still deriving, wait
  // a beat for it (the effect re-runs when it lands), then fall back to the
  // owner wallet so nobody is left off the list because a derivation stalled.
  const started = useRef<string | null>(null);
  const { mutate } = mutation;
  useEffect(() => {
    if (demo || !userId || !access || access.status !== "none") return;
    if (started.current === userId) return;
    if (smart) {
      started.current = userId;
      mutate(smart);
      return;
    }
    const t = window.setTimeout(() => {
      if (started.current === userId) return;
      started.current = userId;
      mutate(walletRef.current?.address);
    }, SMART_ACCOUNT_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [demo, userId, access, smart, mutate]);

  return {
    joining: mutation.isPending || (access?.status === "none" && !mutation.isError),
    joinError: mutation.error ? mutation.error.message : null,
    retryJoin: () => {
      started.current = null;
      mutation.reset();
      mutate(smart ?? walletRef.current?.address);
      started.current = userId;
    },
  };
}

export function useBetaStats(): { stats: BetaStats | null } {
  const q = useQuery({
    queryKey: ["beta-stats"],
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<BetaStats> => readJson<BetaStats>(await fetch("/api/beta/stats")),
  });
  return { stats: q.data ?? null };
}
