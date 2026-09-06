import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Beta list",
  robots: { index: false, follow: false },
};

export default function AdminBetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
