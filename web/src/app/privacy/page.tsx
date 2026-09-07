import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalPage, type LegalSection } from "@/components/site/LegalPage";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What Stax collects, what it never collects, who it shares with, and how to reach us. Plain words, no tracking cookies.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Stax · Privacy",
    description: "What Stax collects, what it never collects, who it shares with, and how to reach us.",
    url: "/privacy",
  },
};

const SECTIONS: LegalSection[] = [
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <p>We keep it to what the product needs to work.</p>
        <ul>
          <li>
            <strong>Sign-in identity.</strong> When you sign in through Privy, we receive the email address, social account
            identifier, or wallet address you chose, plus a Privy user ID. That is how we know it is you next time.
          </li>
          <li>
            <strong>Wallet addresses.</strong> Your Stax smart account address and the wallet that owns it. We store them
            so the app can show your holdings and so the beta list knows which account is yours.
          </li>
          <li>
            <strong>On-chain activity.</strong> Every deposit, trade, and withdrawal happens on Base, a public
            blockchain. Those records are visible to anyone, forever, and are not controlled by us. We read them to show
            you your history and receipts.
          </li>
          <li>
            <strong>Beta and referral data.</strong> If you join the private beta, we store when you joined, your
            referral code, and who joined with your link.
          </li>
          <li>
            <strong>Analytics.</strong> We use Vercel Analytics to count page views and see which pages people use. It
            sets no cookies and does not identify you across sites.
          </li>
          <li>
            <strong>Server logs.</strong> Our servers log requests, including your IP address and browser type, for a
            short time, to keep the service running and to stop abuse. When something breaks we record the error and the
            page it happened on.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "dont",
    title: "What we don't collect",
    body: (
      <ul>
        <li>
          <strong>No card or bank details.</strong> When you add money with a card, the payment is handled by a third
          party. Card numbers never reach us.
        </li>
        <li>
          <strong>No private keys.</strong> Your Stax account is self-custodial. Keys stay with Privy’s embedded
          wallet or your own wallet. We cannot move your money without you.
        </li>
        <li>
          <strong>No selling of data.</strong> We do not sell your information, and we do not share it with advertisers.
        </li>
        <li>
          <strong>No tracking cookies.</strong> Cookies and local storage are used only to keep you signed in and to
          remember settings like your theme.
        </li>
      </ul>
    ),
  },
  {
    id: "third-parties",
    title: "Who we share with",
    body: (
      <>
        <p>Stax runs on a small set of services. Each one sees only what it needs to do its job.</p>
        <ul>
          <li>
            <strong>Privy</strong> handles sign-in and the embedded wallet. It sees your login identity.
          </li>
          <li>
            <strong>Coinbase</strong> issues the tokenized stocks (B20 tokens) on Base. Your trades interact with their
            contracts on-chain.
          </li>
          <li>
            <strong>Aave</strong> is the protocol that holds your safe dollars. On-chain only.
          </li>
          <li>
            <strong>Pimlico</strong> sponsors the network fees for your transactions and sees the transactions it pays
            for.
          </li>
          <li>
            <strong>Relay</strong> moves deposits from other chains to Base and sees the addresses involved.
          </li>
          <li>
            <strong>Neon</strong> hosts our database, where the account and beta records above live.
          </li>
          <li>
            <strong>Vercel</strong> hosts the site and the app and provides the cookieless analytics.
          </li>
        </ul>
        <p>
          Beyond these, we share data only if the law requires it or to protect the people who use Stax from fraud or
          abuse.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <>
        <p>
          Account, wallet, and beta records stay for as long as you have an account. Server logs are kept for a short
          time, typically no more than 30 days. Error reports are kept for up to 90 days.
        </p>
        <p>
          On-chain records are outside our control. They stay on Base permanently, whether or not you still use Stax.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>
          You can ask us what we hold about you, ask us to correct it, or ask us to delete it. Deleting removes your
          account records from our database; it cannot remove anything already written to the blockchain.
        </p>
        <p>
          Depending on where you live, you may have further rights under laws like the GDPR or the CCPA. We will honour
          them. Write to us and we will respond within 30 days.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes",
    body: (
      <p>
        If we change this policy in a way that matters, we will update the date at the top and say so on the site before
        the change takes effect.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about your data go to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. A real person reads
        it.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      intro="Stax collects as little as it can, keeps it only as long as it needs to, and never sells it. Here is the whole picture."
      sections={SECTIONS}
      current="/privacy"
    />
  );
}
