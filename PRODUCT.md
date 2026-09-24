# PRODUCT

## What it is

Stax is an AI stock broker for your phone. You tell Vera, its assistant, what you want in a
sentence ("$50 in AI and space, nothing too wild"). She turns that into a basket of real
tokenized stocks, signs the plan with her own key, and an on-chain contract checks the plan
against the limits you set before any money moves. You sign in with email, Google or X. There
is no seed phrase, and the app sponsors network fees. Around that core are ready-made baskets,
Autopilot (the same plan on a schedule), and gifting: a basket bought now, locked in a contract
until a date, and claimed with an email or X handle.

## Who it is for

- Primary user: someone who can use a banking or payments app but has never bought a stock and
  does not know what a ticker or a wallet is. They open Stax on their phone to put a small amount
  to work without learning a brokerage or crypto.
- Secondary: confident users who want hands-on control (Pro mode), and people who want to give a
  first investment to someone else (gifting).

## Job to be done

When I have some money I want to put to work but brokerages and crypto both feel intimidating,
I want to say what I want in plain words and have it built for me, so I can own real companies
without learning the machinery or trusting an AI blindly.

## What it is not

- Not a derivatives venue: spot only, no perps, no leverage.
- Not a custodian: funds sit in the user's own ERC-4337 smart account; contracts hold nothing
  between calls except parked gifts.
- Not a trading terminal for professionals. Pro mode adds control, not HFT tooling.
- Not a token launch. There is no Stax token.

## Success signals

- A first-time user places their first investment within 2 minutes of signing in.
- Zero reverted user operations reported as failures that actually succeeded (see the gift
  confirmation incident, 2026-09-10).
- Autopilot runs on schedule with no manual restarts.
- For the BNB Hack: a judge can open the live link, get in with an invite code, and buy a
  tokenized stock on BSC in one session.

## Constraints

- Chains / networks: Base mainnet (default, chainId 8453). Mantle mainnet (5000), kept as a
  second mode. BSC mainnet (56), being added for the BNB Hack. Mainnet everywhere; the BNB Hack
  rules require BSC mainnet and forbid testnet-only demos.
- Money: yes, value moves. Users sign through Privy embedded wallets that own ERC-4337
  SimpleAccounts; Pimlico sponsors gas. Autopilot signs server-side through Privy's delegated
  server-wallet API. The four Base contracts are owned by one EOA
  (`0xc6D7709dD8bA53832bd578A88260f8b8E59Fb4C7`), which also receives fees, with no multisig or
  timelock. TODO: the deployer key is read from `contracts/.env` on the builder's machine, which
  the global rules say should not hold it.
- Regulatory / distribution: private beta behind a waitlist, with invite codes and referrals.
  For eligible non-US users only. Tokenized stocks are issued by third parties (Coinbase on Base,
  Backed on Mantle, bStocks / Ondo / xStocks on BSC); Stax does not issue securities. TODO:
  governing-law jurisdiction in `/terms` is still a placeholder.

## Competitive wedge

Every AI finance app asks you to trust the model. Stax does not: Vera's plan is EIP-712 signed,
and `InferenceVerifier` plus `StaxExecutor` refuse a plan she did not sign, risk above your
ceiling, any asset or venue off the allowlist, or a cent more than you approved. That makes the AI
advisory and the contract authoritative. Retail brokers have better UX but no verifiable limits;
crypto wallets have custody but no guidance. Stax pairs the two for someone who has used neither.

## Open product questions

- Deploy `StaxExecutor` + `InferenceVerifier` on BSC mainnet: decided to build both paths and deploy
  later (ADR-0005). The deploy itself is an on-chain write the human runs.
- BSC cash is USDT (ADR-0006). No Stax fee on BSC during judging (ADR-0007).
- BSC features bStock and Ondo; xStocks is not in the Binance API (ADR-0009).
- No Agent Studio and no Agentic Wallet work (ADR-0010).
