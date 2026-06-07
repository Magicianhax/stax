import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Fraunces, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Providers } from "./providers";

// Stax "Soft" theme fonts (see globals.css):
//   UI       → Hanken Grotesk  → --font-hanken     (clean humanist sans)
//   Display  → Fraunces        → --font-fraunces   (warm old-style serif, optical)
//   Mono     → JetBrains Mono  → --font-jetbrains  (data / addresses / receipts)
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const SITE_NAME = "Stax";
const DESCRIPTION =
  "Invest in real companies with Vera, your investing assistant. Email login, no seed phrase, fees on us.";

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  title: {
    default: "Stax · Invest with Vera",
    template: "%s · Stax",
  },
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: SITE_NAME,
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  // Soft "paper" — light by default, dark variant for dark mode.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#15191a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${fraunces.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full antialiased">
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
