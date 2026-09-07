import type { Metadata } from "next";
import { CONTACT_EMAIL, Fill, LegalPage, type LegalSection } from "@/components/site/LegalPage";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The terms for using Stax: who can use it, what it is and isn't, fees, the private beta, and the limits of our responsibility.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Stax · Terms",
    description: "Who can use Stax, what it is and isn't, fees, the private beta, and the limits of our responsibility.",
    url: "/terms",
  },
};

const SECTIONS: LegalSection[] = [
  {
    id: "eligibility",
    title: "Who can use Stax",
    body: (
      <>
        <p>You must be at least 18 years old, or the age of majority where you live if that is higher.</p>
        <p>
          Tokenized stocks are offered by their issuers to eligible people outside the United States. Stax is not
          available where it, or the assets it offers, would be prohibited. If that is you, the demo is still open; the
          app is not. It is your responsibility to check the rules that apply where you live.
        </p>
      </>
    ),
  },
  {
    id: "service",
    title: "What Stax is, and isn't",
    body: (
      <>
        <ul>
          <li>
            <strong>Self-custodial.</strong> Your Stax account is a smart account on Base that only you control. We
            cannot move, freeze, or recover your money. If you lose access to your login, we may not be able to help you
            get it back.
          </li>
          <li>
            <strong>Vera is an AI assistant, not an adviser.</strong> Vera builds plans from what you tell her and
            explains them. She can be wrong. Nothing she says is financial, investment, tax, or legal advice, and
            nothing moves until you read the plan and confirm it yourself.
          </li>
          <li>
            <strong>Tokenized stocks are issued by third parties.</strong> The stocks you buy are tokens issued by
            Coinbase on Base, backed by real shares held by the issuer. Stax does not issue them, hold the shares, or
            control the issuer. The issuer’s own terms apply to those tokens.
          </li>
          <li>
            <strong>Safe dollars use Aave.</strong> Cash you park as safe dollars is deposited into the Aave protocol.
            Yield is variable and not guaranteed.
          </li>
          <li>
            <strong>You can lose money.</strong> Stock prices go up and down. Smart contracts, blockchains, and the
            services we depend on can fail. You may lose some or all of what you put in.
          </li>
          <li>
            <strong>No guarantees.</strong> We do not promise any return, any price, or that the service will always be
            available or error-free.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "fees",
    title: "Fees",
    body: (
      <>
        <p>
          Stax charges a flat fee of 0.25% of the amount on each trade. It is shown on the plan before you confirm and
          on the receipt afterwards.
        </p>
        <p>
          Network fees (gas) are sponsored by Stax today, so you do not pay them. We may change that in the future and
          will say so in the app before we do. Third parties, such as the issuer or a card provider you use to add
          money, may charge their own fees.
        </p>
      </>
    ),
  },
  {
    id: "beta",
    title: "Private beta",
    body: (
      <>
        <p>
          Stax is in private beta. We may limit who can use the app, add or remove features, change limits, and pause
          the service while we fix things. Access can be granted or withdrawn at our discretion.
        </p>
        <p>
          The waitlist and referral system are ours to run. We may remove entries that look automated or abusive.
        </p>
      </>
    ),
  },
  {
    id: "conduct",
    title: "What you agree not to do",
    body: (
      <ul>
        <li>Use Stax if you are not eligible, or on behalf of someone who is not.</li>
        <li>Break the law, including sanctions, anti-money-laundering, and securities rules that apply to you.</li>
        <li>Attack, overload, scrape, or reverse-engineer the service, or get around its limits.</li>
        <li>Create many accounts, game the beta list, or use bots to interact with Stax.</li>
        <li>Use Stax to harm other people.</li>
      </ul>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        Stax is provided as is and as available, without warranties of any kind, express or implied, including
        merchantability, fitness for a particular purpose, and non-infringement. Data in the app, including prices, plans,
        and Vera’s track record, may be delayed, incomplete, or wrong.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <p>
        To the fullest extent the law allows, Stax and the people who build it are not liable for any indirect,
        incidental, special, or consequential loss, or any loss of money, profits, or data, arising from your use of the
        service, the assets in it, or the third parties it relies on. Our total liability for any claim is limited to
        the fees you paid us in the twelve months before the claim.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of <Fill>[Jurisdiction]</Fill>, and any dispute will be heard by the courts
        there.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes",
    body: (
      <p>
        We may update these terms. If a change matters, we will update the date at the top and tell you in the app or on
        the site before it takes effect. Using Stax after that means you accept the new terms.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about these terms go to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      intro="The short version: you own your account, Vera suggests and you decide, and the stocks are real but issued by someone else. The long version follows."
      sections={SECTIONS}
      current="/terms"
    />
  );
}
