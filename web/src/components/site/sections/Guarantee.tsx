"use client";

// "What Stax refuses." The promise, stated as the things Stax won't do on BNB
// Chain, each one a rule the app enforces: no buy while the US market is shut
// (the weekend premium), nothing under the $6-per-stock floor, no trade
// Binance's test says would fail, no leveraged fund nobody asked for. Four
// rules on the 12-column grid (3 each on desktop), each with a short accent
// stub on its hairline.
//
// Under them, one quiet line for the signed-plan contract, naming only the
// networks it is live and verified on, each name a link to the explorer. The
// user asked for refusals instead of a table of contract addresses; that
// stays: no hex on the page, the proof one click away.
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { explorerAddress } from "@/lib/chains";
import { CONTRACT_CLAUSE, REFUSALS, REFUSE_TITLE, liveContractChains } from "@/lib/site/landing";
import { Reveal } from "../ui/Reveal";
import l from "../layout.module.css";
import s from "./Guarantee.module.css";

/**
 * "On BNB Chain ↗ and Mantle ↗, a contract also checks …". The executor is the contract that
 * moves the money, so it is the one worth opening; naming the network rather
 * than printing the address keeps the proof and drops the forty characters
 * nobody reads.
 */
function ContractLine() {
  const live = liveContractChains();
  if (live.length === 0) return null;
  return (
    <p className={s.verified}>
      On{" "}
      {live.map((chain, i) => (
        <span key={chain.key}>
          {i > 0 && (i === live.length - 1 ? " and " : ", ")}
          <a
            className={s.verifiedLink}
            href={explorerAddress(chain, chain.contracts.executor)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${chain.name}: the contract on ${chain.explorer.name}`}
          >
            <Image src={chain.brand.logo} alt="" width={16} height={16} className={s.chainLogo} />
            {chain.name}
            <ArrowUpRight size={13} strokeWidth={2.4} aria-hidden className={s.arrow} />
          </a>
        </span>
      ))}
      {CONTRACT_CLAUSE}
    </p>
  );
}

export function Guarantee() {
  return (
    <section className={l.sec} id="guarantee" aria-labelledby="guarantee-title">
      <div className={l.wrap}>
        <div className={l.head}>
          <h2 id="guarantee-title" className={l.h2}>
            {REFUSE_TITLE}
          </h2>
        </div>

        <Reveal as="ul" className={s.refusals} stagger={0.05}>
          {REFUSALS.map((r) => (
            <li key={r.title} className={s.refusal}>
              <h3 className={s.refusalTitle}>{r.title}</h3>
              <p className={s.refusalNote}>{r.note}</p>
            </li>
          ))}
        </Reveal>
        <ContractLine />
      </div>
    </section>
  );
}
