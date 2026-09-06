import type { Metadata } from "next";
import { BetaPage } from "@/components/site/beta/BetaPage";

export const metadata: Metadata = {
  title: "Private beta",
  description: "Stax is in private beta. Sign in to hold a place in line; every friend who joins with your link moves you up.",
  alternates: { canonical: "/beta" },
  openGraph: {
    title: "Stax · Private beta",
    description: "Sign in to hold a place in line. Every friend who joins with your link moves you up.",
    url: "/beta",
  },
};

// The waitlist. Signed out: the line + login. Signed in: your place, your link.
export default function BetaRoute() {
  return <BetaPage />;
}
