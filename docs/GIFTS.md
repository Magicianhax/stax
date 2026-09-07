# Gift a basket

Buy a Stax basket for someone else, addressed to their email, locked until a date you
pick. They claim it when it opens. If they never do, you get it back.

The recipient does not need a wallet, an account, or even to have heard of Stax when you
send it. They need an email address, and later, that email on a Privy sign-in.

---

## The flow

**Give.** You pick a basket, an amount, a recipient email and an unlock date. The tokens
are bought through the normal executor path, land in your own smart account, and are then
parked in the `TimelockGift` contract against a hash of the recipient's email.

**Park.** The contract holds the tokens. Nobody can move them before `unlockAt` — not you,
not the recipient, not the contract's owner.

**Link.** You get a share link, `/gift/<giftId>`, on the marketing site rather than inside
the app. Someone who has never heard of Stax lands on the note, the basket, the amount,
the unlock date and your first name, and chooses to open the app from there. No email, no
addresses.

**Claim.** After `unlockAt`, the recipient signs in with that email and asks Stax for a
claim authorisation. The server checks their Privy record, signs an EIP-712 attestation,
and their sponsored user op calls `claim`. The tokens move to their Stax smart account.

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

Fee-on-transfer tokens would break the accounting, because `create` records the amount it
asked for rather than the balance delta. No such token is in the Stax asset set. If one is
ever added, `create` must measure the delta instead.

### Tests

`contracts/test/TimelockGift.test.js`, ten cases, run with `npx hardhat test`. They cover
create and the pull-in, every malformed-create revert, claim before unlock, claim with a
forged signature, claim with a valid signature for a different destination, an expired
authorisation, a successful claim submitted by a third party, a replayed claim, reclaim
before the window, reclaim by a stranger, a successful reclaim, an unknown id, and signer
rotation.

---

## The data

`gifts` in `web/src/lib/db/schema.ts`, migrations `0005_icy_strong_guy.sql` and
`0006_dusty_killraven.sql`.

The row id **is** the on-chain `giftId` (`0x` + 32 random bytes), which is also the share
link. One id, three places.

The recipient's email is never stored. Two different hashes are taken of it, for two
different jobs:

- **`recipient_email_hash`** is deterministic and peppered with `GIFT_EMAIL_PEPPER`. It is
  indexed on `(chain, recipient_email_hash)`, which makes "gifts addressed to me" a single
  indexed lookup instead of a scan of every gift ever sent. The pepper is what stops a
  stolen dump from being run through a wordlist of email addresses.
- **`recipientHash` on-chain** uses `recipient_salt`, which is fresh per gift. Two gifts to
  the same person therefore share no on-chain value, so nobody reading Base can link them.

`recipient_email_masked` (`a•••@gmail.com`) is shown back to the giver only, so they can
tell two recipients apart without the address being readable over someone's shoulder.

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
| `POST /api/gifts/quote` | public | Allocation preview for a basket and an amount. No writes. |
| `POST /api/gifts` | yes | Validates, reserves the `pending` row, returns the giftId, hashes, dates, note and allocation. |
| `GET /api/gifts` | yes | Gifts I sent and gifts addressed to my email, with `claimable` and `reclaimable` precomputed. |
| `POST /api/gifts/:id/funded` | yes | Marks funded, after re-reading the contract. |
| `POST /api/gifts/:id/claim-authorisation` | yes | Signs the EIP-712 claim attestation. |
| `POST /api/gifts/:id/claimed` | yes | Records the settling transaction, claim or reclaim. |
| `GET /api/gifts/preview?id=` | public | The share-link landing payload. |

`POST /api/gifts` enforces the amount floor and ceiling, the caller's actual USDC balance,
the unlock-date window, the email shape and the note cap. The note is capped at 200
**bytes** on a code-point boundary, because that is what the contract counts.

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

The contract cannot know who owns an email address. It delegates that one question to the
Stax server, and accepts a signature as the answer. That is the only reason the signature
exists, and it is why `claim-authorisation` is the route to read carefully.

What the server checks before it signs, in order:

1. The caller has a live Privy session. The user id comes from the verified access token.
2. Privy has an email on their **user record**, fetched server-side with the app
   credentials. The request body is never consulted for an email, and there is no field
   for one.
3. That email's lookup hash equals the gift's `recipient_email_hash`.
4. The gift is `funded`, not already claimed or reclaimed, and past its unlock date.
5. `to` is the caller's **own** smart account, derived from Privy by `ownedAddresses`.
   There is no way to ask for the gift to be sent elsewhere.
6. The contract itself agrees: the gift exists, is unclaimed, and has passed `unlockAt`.

Only then does it sign `Claim(giftId, to, deadline)` with `GIFT_SIGNER_PRIVATE_KEY`.

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
