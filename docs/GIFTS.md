# Gift a basket

Buy a Stax basket for someone else, addressed to their email or their X username, locked
until a date you pick. They claim it when it opens. If they never do, you get it back.

The recipient does not need a wallet, an account, or even to have heard of Stax when you
send it. They need an email address or an X account, and later, that identity on a Privy
sign-in.

---

## Who a gift is for

A gift carries one of two recipient kinds, and that is the **only** thing that differs
between them. Same contract, same signature, same hashes, same unlock date.

| `recipient_kind` | Addressed to | Claimed by signing in with |
| --- | --- | --- |
| `email` | an email address | that email, through Privy |
| `x` | an X (Twitter) username | that X account, through Privy |

Both are normalised before anything is hashed: an email is trimmed and lowercased, and an
X username loses a leading `@` and is lowercased, because X handles are case-insensitive.
`parseGiftRecipient` in `web/src/lib/gifts.ts` does both, and the give flow and the API
call the same function, so a recipient the screen accepts is never one the server refuses.
A username is valid on X's own rule: 1–15 characters of `[A-Za-z0-9_]`.

**An X handle can change hands, and an email address cannot.** X releases and re-issues
usernames, so a gift addressed to `@name` is claimable by whoever holds `@name` on the day
it unlocks, which may not be the person the giver had in mind years earlier. There is no
way to close that window without an identity X does not expose. What bounds it is that a
gift can be claimed exactly once, and the giver sees the claim on their own gift.

---

## The flow

**Give.** You pick a basket, an amount, a recipient and an unlock date. The tokens
are bought through the normal executor path, land in your own smart account, and are then
parked in the `TimelockGift` contract against a hash of the recipient's email or handle.

**Park.** The contract holds the tokens. Nobody can move them before `unlockAt` — not you,
not the recipient, not the contract's owner.

**Link.** You get a share link, `/gift/<giftId>`, on the marketing site rather than inside
the app. Someone who has never heard of Stax lands on the note, the basket, the amount,
the unlock date and your first name, and chooses to open the app from there. No email, no
addresses.

**Claim.** After `unlockAt`, the recipient signs in with that email or that X account and
asks Stax for a claim authorisation. The server checks their Privy record, signs an EIP-712
attestation, and their sponsored user op calls `claim`. The tokens move to their Stax smart
account.

**Reclaim.** If nobody ever claims, then 90 days after `unlockAt` the giver may call
`reclaim` and take the tokens back. Nothing is ever stranded.

---

## Why the tokens are parked in a second transaction

`StaxExecutor.investWithAI` forwards every bought token to `msg.sender`. There is no
recipient parameter — the executor is non-custodial by construction and holds nothing
between calls. So a gift cannot be bought directly into the gift contract.

The flow is therefore two sponsored user ops, not one:

1. The normal invest batch: platform fee, `USDC.approve(executor)`, `investWithAI`. The
   bought tokens land in the giver's smart account.
2. A second batch: one `ERC20.approve(gift, amount)` per token, then
   `TimelockGift.create(...)`.

The exact amounts are only known after the first transaction, because each leg's output
depends on the price at execution. The client reads them from the `LegFilled(planId,
tokenOut, usdcIn, received)` events on the invest receipt. Not from `minOut`, and not from
the USD weights.

Both user ops are gasless, so the giver sees two confirmations and pays no gas.

---

## The contract

`contracts/contracts/TimelockGift.sol`. Solidity 0.8.24, OpenZeppelin `SafeERC20`,
`ReentrancyGuard`, `Ownable`, `EIP712`, `ECDSA`. EIP-712 domain `("StaxGift", "1")`.

```solidity
struct Gift {
    address from;            // the giver; the only address that may reclaim
    bytes32 recipientHash;   // hash of the recipient's email + a per-gift salt
    uint64  unlockAt;        // claimable from here
    uint64  reclaimAfter;    // giver may take it back from here
    bool    claimed;         // set once, by claim OR reclaim
    address[] tokens;
    uint256[] amounts;
    string  note;            // <= 200 bytes
}
```

| Function | Who | When |
| --- | --- | --- |
| `create(giftId, recipientHash, unlockAt, reclaimAfter, tokens, amounts, note)` | anyone, pulls from `msg.sender` | any time |
| `claim(giftId, to, deadline, signature)` | anyone with a valid signature | after `unlockAt`, before `deadline` |
| `reclaim(giftId)` | the giver only | after `reclaimAfter` |
| `setSigner(address)` | the owner | any time |
| `getGift(giftId)` / `isClaimable(giftId)` | anyone | view |

`create` reverts on a duplicate id, no tokens, a token/amount length mismatch, a zero
token address, a zero amount, an `unlockAt` at or before now, a `reclaimAfter` at or
before `unlockAt`, and a note over 200 bytes.

`claim` reverts on an unknown id, an already-claimed gift, a time before `unlockAt`, a
passed `deadline`, a zero `to`, an unset signer, and any recovered address that is not the
signer.

`reclaim` reverts on an unknown id, an already-claimed gift, a caller who is not the
giver, and a time before `reclaimAfter`.

`recipientHash` is recorded for the giver's audit trail and for indexers. The contract
never checks it, because only the server can link an email to a person.

### Why the safe slice is parked as cash

`create` **records** the amounts it is given; `claim` and `reclaim` pay back exactly those,
never the live balance. That is a problem for one asset already in the set.

Aave "Safe Dollars" (`aUSDC`, aBasUSDC) rebases: its balance grows as interest accrues, and
the curated **Safe Growth** basket holds it at 40%. Park the aToken and every cent it earns
while it waits — up to 25 years of it — sits in the contract forever, because there is no
rescue function and the payout is fixed at the recorded amount.

So a gift never parks the aToken. The safe slice is held as **plain USDC**: the invest step
buys only the other legs, and the dollars for this one go straight into `create`. The
recipient can supply them to Aave themselves the moment they claim. Nothing is stranded,
every basket stays giftable, and the contract needs no new powers.

Two alternatives were considered and rejected. Refusing to gift baskets that hold aUSDC
would make a curated basket ungiftable for an implementation detail. Paying out by balance
delta does not work either: one token balance is shared by every gift in the contract, so
per-gift yield cannot be attributed without scaled-balance accounting, which is a great
deal of machinery and a new class of bug for a slice that earns a few percent.

The split lives in `splitGiftBasket` in `web/src/lib/gifts.ts`, and it is arithmetic on raw
6-decimal USDC so `investUsd + cashUsd` always equals the gift amount exactly.
`POST /api/gifts` returns `investUsd` (pass that to `/api/invest-plan`, not the gift's full
amount), `cashToken` (the USDC to park, already in raw units), and `holdings` with the cash
slices marked `heldAsCash`. `mergeGiftTokens` folds the bought tokens and the
cash slice into one entry per address. Call it once and use the result everywhere: the
approvals, `create`, and the `funded` body the server matches against the contract all need
the same list, and a second implementation of that fold could drift, with the failure only
surfacing after two on-chain transactions have already happened. It is idempotent, and
`giftCreateCalls` runs it too, so passing an already-merged list is safe.

The same rule covers fee-on-transfer tokens, which would pay out more than arrived. None is
in the Stax asset set. Any future rebasing venue belongs in `isHeldAsCash`.

### Tests

`contracts/test/TimelockGift.test.js`, ten cases, run with `npx hardhat test`. They cover
create and the pull-in, every malformed-create revert, claim before unlock, claim with a
forged signature, claim with a valid signature for a different destination, an expired
authorisation, a successful claim submitted by a third party, a replayed claim, reclaim
before the window, reclaim by a stranger, a successful reclaim, an unknown id, and signer
rotation.

The money maths and the recipient rules have their own suite: `web/src/lib/gifts.test.ts`,
run with `npm test` in `web/`. It covers `splitGiftBasket`, `mergeGiftTokens`,
`giftCreateCalls`, the review card's four money lines, and the recipient front door —
`normalizeXUsername`, `looksLikeXUsername`, `parseGiftRecipient` and `recipientLabel`. The
recipient cases matter because the screen and the server run the same functions: anything
they normalised differently would let a gift be addressed to one string and claimed against
another. It runs in CI as the "Money maths" step and inside
`npm run verify`, so a broken money invariant fails a Vercel build the same way a type
error does. Vitest is configured for node and pure functions only — no jsdom, no
testing-library, nothing that renders.

Two of its assertions exist because of bugs that shipped past review. The cash row must
equal the cash total exactly: the card once spread the platform fee across every holding,
showing $39.94 against a summary line reading $40.00, and only the distribution was wrong
so every total still balanced. And the displayed lines are bounded to within one cent of
what the giver pays: three lines each rounded on their own do not always sum to the rounded
total, so a card that wants exact agreement has to let one line absorb the remainder, the
way `splitByWeight` lets the last leg take the dust.

---

## The data

`gifts` in `web/src/lib/db/schema.ts`, migrations `0005_icy_strong_guy.sql`,
`0006_dusty_killraven.sql` and `0007_wakeful_rachel_grey.sql` (which adds
`recipient_kind`).

The row id **is** the on-chain `giftId` (`0x` + 32 random bytes), which is also the share
link. One id, three places.

`recipient_kind` is `'email'` or `'x'`, defaulting to `'email'` so every row written before
X recipients existed keeps its meaning without a backfill.

The recipient's address or handle is never stored. Both kinds reuse the same two hash
columns, so nothing about the storage or the contract changes with the kind. Two different
hashes are taken, for two different jobs:

- **`recipient_email_hash`** is deterministic and peppered with `GIFT_EMAIL_PEPPER`. It is
  indexed on `(chain, recipient_email_hash)`, which makes "gifts addressed to me" a single
  indexed lookup instead of a scan of every gift ever sent. The pepper is what stops a
  stolen dump from being run through a wordlist of email addresses.
- **`recipientHash` on-chain** uses `recipient_salt`, which is fresh per gift. Two gifts to
  the same person therefore share no on-chain value, so nobody reading Base can link them.

Each kind hashes inside its own namespace — an X handle goes in as `x:<handle>` — so an
address and a handle can never collide, and every email gift written before X existed still
hashes to exactly the string already stored against it.

`recipient_email_masked` is the giver's display line, and it is the one place the two kinds
look different: an email is masked (`a•••@gmail.com`) because it is private, and a handle is
stored whole (`@jack`) because it is already public. Shown back to the giver only, so they
can tell two recipients apart, and never on the public share page.

`holdings` is the basket's split as it was on the day the gift was given, snapshotted onto
the row rather than looked up later. A gift can sit here for 25 years and a shared basket
can be deleted long before it opens, so a lookup would eventually draw an empty page.
Weights are not sensitive — a curated basket's are already public in `lib/baskets.ts` — so
they ride along on the public preview and draw its asset tiles. Amounts never do.

`status` walks `pending` → `funded` → (`claimed` | `reclaimed`). `failed` is a gift whose
parking transaction never landed. A `pending` gift is invisible to the public preview: it
answers 404, exactly as it would for an id that never existed.

Helpers live in `web/src/lib/server/giftsStore.ts`. Shared client-safe types, constants,
display helpers and the ABI live in `web/src/lib/gifts.ts` — both halves of the feature
import from there.

---

## The API

Every authed route takes the Privy bearer token and the `x-stax-chain` header, validates
its body with Zod, and is rate limited. Types are exported from `@/lib/gifts`.

| Route | Auth | What it does |
| --- | --- | --- |
| `POST /api/gifts` | yes | Validates, reserves the `pending` row, returns the giftId, hashes, dates, note and allocation. |
| `GET /api/gifts` | yes | Gifts I sent and gifts addressed to any identity Privy holds for me, with `claimable` and `reclaimable` precomputed. |
| `POST /api/gifts/:id/funded` | yes | Marks funded, after re-reading the contract. |
| `POST /api/gifts/:id/claim-authorisation` | yes | Signs the EIP-712 claim attestation. |
| `POST /api/gifts/:id/claimed` | yes | Records the settling transaction, claim or reclaim. |
| `GET /api/gifts/preview?id=` | public | The share-link landing payload. |

There is deliberately no pricing endpoint. `splitGiftBasket` is client-safe, so the review
card runs the very function the server runs, which means the preview cannot disagree with
what `create` does and it works in demo with no round trip. An endpoint nobody called would
drift out of step with the real path precisely because nothing exercised it. If a public
pricing route is ever wanted, add it back against the same function.

`POST /api/gifts` takes the recipient as a discriminated union,
`recipient: { kind: "email", email } | { kind: "x", username }`, so a body can never arrive
carrying both with no rule for which wins. A bare `recipientEmail` is still accepted and
read as the email kind, so an older client keeps working. The route enforces the amount
floor and ceiling, the caller's actual USDC balance, the unlock-date window, the recipient
shape and the note cap. The note is capped at 200 **bytes** on a code-point boundary,
because that is what the contract counts.

`POST /api/gifts/:id/funded` treats the body as a hint and never as the truth. It reads
`getGift` on chain and refuses unless the gift is really there, was created by this
caller's recorded account, carries the unlock and reclaim dates we recorded, and holds
exactly the tokens and amounts the body claims, matched by address and order-independent.

`POST /api/gifts/:id/claimed` handles both ways out, because on-chain they look identical:
`claimed` is set by `claim` and by `reclaim` alike. Which one it was is decided by who is
asking — the recipient records a claim, the giver records a reclaim.

The public preview has two front doors over one reader, `loadGiftPreview` in
`web/src/lib/server/giftPreview.ts`. A server component imports it directly, which beats
fetching our own route handler: no absolute-URL guessing and a null it can turn into
`notFound()`. The route handler is the same thing over HTTP for client-side callers. Both
go through the reader, so they cannot disagree about what is safe to show.

Encoding the on-chain calls is not the UI's job either. `web/src/lib/gifts.ts` exports
`giftCreateCalls`, `giftClaimCall` and `giftReclaimCall`, which return the exact batches to
hand `sendSponsoredCalls`. The ABI, the argument order and the bigint conversions have one
home.

---

## The security model

The contract cannot know who owns an email address or an X handle. It delegates that one
question to the Stax server, and accepts a signature as the answer. That is the only reason
the signature exists, and it is why `claim-authorisation` is the route to read carefully.

What the server checks before it signs, in order:

1. The caller has a live Privy session. The user id comes from the verified access token.
2. Privy has the identity this gift's `recipient_kind` names on their **user record**,
   fetched server-side with the app credentials — an email from `fetchPrivyEmail`, or an X
   username from `fetchPrivyXUsername`. The request body is never consulted for either, and
   there is no field for one.
3. That identity's lookup hash equals the gift's `recipient_email_hash`.
4. The gift is `funded`, not already claimed or reclaimed, and past its unlock date.
5. `to` is the caller's **own** smart account, derived from Privy by `ownedAddresses`.
   There is no way to ask for the gift to be sent elsewhere.
6. The contract itself agrees: the gift exists, is unclaimed, and has passed `unlockAt`.

Only then does it sign `Claim(giftId, to, deadline)` with `GIFT_SIGNER_PRIVATE_KEY`.

Steps 2 and 3 are one function, `callerOwnsRecipient` in `web/src/lib/server/giftsStore.ts`,
and both claim routes go through it, so the email path and the X path cannot drift apart.
The email half keeps the `EMAIL_TRUSTED_PROVIDERS` guard in `privyAuth.ts` exactly as it
was: several OAuth providers hand over a profile `email` the holder never proved they
control, so only Privy's own verified `email` account and providers that verify it are
trusted. X needs no equivalent, and the difference is worth being precise about — a
`twitter_oauth` account's `username` is not a claim about a third party, it is what X
itself returned for the account that just completed the handshake. The residual risk with X
is not impersonation at claim time but that handles change hands over the years, which is
the caveat under "Who a gift is for".

The attestation lives ten minutes. It names one destination, so a leaked signature can
only send the gift where it was already going. It names one gift, so it cannot be reused
on another. The contract sets `claimed` before any transfer, so it cannot be replayed even
inside its window.

Knowing a `giftId` gets you the public preview and nothing else. The preview carries no
email, no addresses, no token amounts and no transaction hashes, so a forwarded link
cannot be turned into a claim.

The signing key is the whole model. It lives in `web/src/lib/server/giftSigner.ts`, which
imports `server-only` as a build-time guard: if that module is ever pulled into a client
bundle the build fails loudly instead of shipping the key. Rotating it invalidates every
outstanding attestation, which is the intended behaviour; call `setSigner` with the new
address and unclaimed gifts are otherwise unaffected.

The owner's powers are deliberately small. `setSigner` is all there is. There is no rescue
function, no pause, no way for the owner to move a parked gift.

---

## Deploying it (owner)

**1. Make the signer key.**

```bash
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log('GIFT_SIGNER_PRIVATE_KEY='+k);console.log('GIFT_SIGNER_ADDRESS='+privateKeyToAccount(k).address)"
```

Put the private key in `web/.env.local` (and the Vercel project's environment) as
`GIFT_SIGNER_PRIVATE_KEY`. Put the address in `contracts/.env` as `GIFT_SIGNER_ADDRESS`.
They must be the same key or nobody can ever claim.

**2. Deploy.** `contracts/.env` needs `PRIVATE_KEY` with a little ETH on Base, plus
`GIFT_SIGNER_ADDRESS`. `ETHERSCAN_API_KEY` is optional and verifies on Basescan.

```bash
cd contracts
npm run deploy:gift-base            # or deploy:gift-base-sepolia
```

The script is resumable in the style of `deploy-base.js`: every transaction waits for its
receipt, a fresh contract is polled until the RPC serves its code, and setting
`STAX_GIFT_BASE` in `contracts/.env` makes a re-run reuse the existing deployment instead
of paying for a second one. It reads the signer back before it reports success.

**3. Wire the app.** Paste the printed address into `web/.env.local` and Vercel:

```
NEXT_PUBLIC_STAX_GIFT_BASE=0x…
```

**4. Set the pepper**, once, before the first real gift:

```
GIFT_EMAIL_PEPPER=<32+ random characters>
```

Never change it afterwards. Every existing row's lookup hash would stop matching and those
gifts would become unclaimable through the app.

Until `NEXT_PUBLIC_STAX_GIFT_BASE` is set, `giftContractFor(chain)` returns null, the gift
screens stay hidden, and every `/api/gifts` route answers 503 with a plain-words message.

### Environment summary

| Variable | Where | What |
| --- | --- | --- |
| `NEXT_PUBLIC_STAX_GIFT_BASE` | `web/.env.local`, Vercel | TimelockGift address on Base. |
| `GIFT_SIGNER_PRIVATE_KEY` | `web/.env.local`, Vercel | Signs claim attestations. Server-only. |
| `GIFT_SIGNER_ADDRESS` | `contracts/.env` | The address of the above, for the deploy script. |
| `GIFT_EMAIL_PEPPER` | `web/.env.local`, Vercel | Optional but recommended. Set once, never rotate. |
