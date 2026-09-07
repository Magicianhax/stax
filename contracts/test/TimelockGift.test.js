const assert = require("node:assert/strict");
const hre = require("hardhat");
const { privateKeyToAccount } = require("viem/accounts");

// TimelockGift — the "gift a basket" park-and-claim contract.
//
// The story each test walks: a giver parks two tokens for an email hash; nothing moves
// before the unlock date; only the Stax attestation key can release it; it releases once;
// and if nobody ever claims, the giver gets it back after the grace period.
//
//   npx hardhat test

// The Stax server's attestation key. Deliberately NOT a hardhat account: the signature
// is produced off-chain, exactly as the API route produces it with GIFT_SIGNER_PRIVATE_KEY.
const SIGNER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const IMPOSTOR_PK = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";

const DAY = 24 * 60 * 60;
const ONE_TOKEN = 10n ** 8n; // the Base tokenized stocks are 8-decimal

const giftId = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const RECIPIENT_HASH = `0x${"ab".repeat(32)}`;

/** Run `fn` and assert it reverted with the named custom error. */
async function expectRevert(fn, errorName) {
  try {
    await fn();
  } catch (err) {
    const message = String(err?.message ?? err);
    assert.ok(
      message.includes(errorName),
      `expected revert ${errorName}, got:\n${message.slice(0, 600)}`,
    );
    return;
  }
  assert.fail(`expected revert ${errorName}, but the call succeeded`);
}

async function increaseTime(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine", []);
}

describe("TimelockGift", () => {
  let publicClient, giver, stranger, recipientAddress;
  let gift, tokenA, tokenB;
  let signerAccount, impostorAccount, domain;

  const CLAIM_TYPES = {
    Claim: [
      { name: "giftId", type: "bytes32" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
  };

  /** The EIP-712 attestation the Stax server hands the recipient. */
  const authorise = (account, id, to, deadline) =>
    account.signTypedData({ domain, types: CLAIM_TYPES, primaryType: "Claim", message: { giftId: id, to, deadline } });

  const now = async () => (await publicClient.getBlock()).timestamp;

  beforeEach(async () => {
    publicClient = await hre.viem.getPublicClient();
    const wallets = await hre.viem.getWalletClients();
    giver = wallets[0];
    stranger = wallets[1];
    recipientAddress = wallets[2].account.address;

    signerAccount = privateKeyToAccount(SIGNER_PK);
    impostorAccount = privateKeyToAccount(IMPOSTOR_PK);

    tokenA = await hre.viem.deployContract("MockERC20", ["Nvidia", "NVDAc", 8]);
    tokenB = await hre.viem.deployContract("MockERC20", ["Apple", "AAPLc", 8]);
    gift = await hre.viem.deployContract("TimelockGift", [signerAccount.address]);

    domain = {
      name: "StaxGift",
      version: "1",
      chainId: await publicClient.getChainId(),
      verifyingContract: gift.address,
    };

    for (const token of [tokenA, tokenB]) {
      await token.write.mint([giver.account.address, 100n * ONE_TOKEN]);
      await token.write.approve([gift.address, 100n * ONE_TOKEN], { account: giver.account });
    }
  });

  /** Park 3 NVDAc + 2 AAPLc unlocking in `unlockInDays`, reclaimable 30 days later. */
  async function createGift(id, { unlockInDays = 30, note = "Happy birthday." } = {}) {
    const unlockAt = (await now()) + BigInt(unlockInDays * DAY);
    const reclaimAfter = unlockAt + BigInt(30 * DAY);
    await gift.write.create(
      [id, RECIPIENT_HASH, unlockAt, reclaimAfter, [tokenA.address, tokenB.address], [3n * ONE_TOKEN, 2n * ONE_TOKEN], note],
      { account: giver.account },
    );
    return { unlockAt, reclaimAfter };
  }

  it("records the gift and pulls the tokens in", async () => {
    const id = giftId(1);
    const { unlockAt, reclaimAfter } = await createGift(id);

    const stored = await gift.read.getGift([id]);
    assert.equal(stored.from.toLowerCase(), giver.account.address.toLowerCase());
    assert.equal(stored.recipientHash, RECIPIENT_HASH);
    assert.equal(stored.unlockAt, unlockAt);
    assert.equal(stored.reclaimAfter, reclaimAfter);
    assert.equal(stored.claimed, false);
    assert.equal(stored.note, "Happy birthday.");
    assert.deepEqual(
      stored.tokens.map((t) => t.toLowerCase()),
      [tokenA.address.toLowerCase(), tokenB.address.toLowerCase()],
    );
    assert.deepEqual(stored.amounts, [3n * ONE_TOKEN, 2n * ONE_TOKEN]);

    assert.equal(await tokenA.read.balanceOf([gift.address]), 3n * ONE_TOKEN);
    assert.equal(await tokenB.read.balanceOf([gift.address]), 2n * ONE_TOKEN);
    assert.equal(await tokenA.read.balanceOf([giver.account.address]), 97n * ONE_TOKEN);
    assert.equal(await gift.read.isClaimable([id]), false);
  });

  it("rejects a malformed gift", async () => {
    const unlockAt = (await now()) + BigInt(30 * DAY);
    const reclaimAfter = unlockAt + BigInt(30 * DAY);
    const args = (over = {}) => [
      over.id ?? giftId(2),
      RECIPIENT_HASH,
      over.unlockAt ?? unlockAt,
      over.reclaimAfter ?? reclaimAfter,
      over.tokens ?? [tokenA.address],
      over.amounts ?? [ONE_TOKEN],
      over.note ?? "",
    ];
    const create = (over) => gift.write.create(args(over), { account: giver.account });

    await expectRevert(() => create({ tokens: [], amounts: [] }), "NoTokens");
    await expectRevert(() => create({ amounts: [ONE_TOKEN, ONE_TOKEN] }), "LengthMismatch");
    await expectRevert(() => create({ amounts: [0n] }), "ZeroAmount");
    const past = (await now()) - 1n;
    await expectRevert(() => create({ unlockAt: past }), "UnlockInPast");
    await expectRevert(() => create({ reclaimAfter: unlockAt }), "ReclaimBeforeUnlock");
    await expectRevert(() => create({ note: "x".repeat(201) }), "NoteTooLong");

    await createGift(giftId(3));
    await expectRevert(() => create({ id: giftId(3) }), "GiftExists");
  });

  it("refuses a claim before the unlock date", async () => {
    const id = giftId(4);
    await createGift(id);
    const deadline = (await now()) + 600n;
    const signature = await authorise(signerAccount, id, recipientAddress, deadline);

    await expectRevert(
      () => gift.write.claim([id, recipientAddress, deadline, signature], { account: stranger.account }),
      "NotYetUnlocked",
    );
  });

  it("refuses a claim signed by anyone but the Stax signer", async () => {
    const id = giftId(5);
    await createGift(id);
    await increaseTime(31 * DAY);

    const deadline = (await now()) + 600n;
    const forged = await authorise(impostorAccount, id, recipientAddress, deadline);
    await expectRevert(
      () => gift.write.claim([id, recipientAddress, deadline, forged], { account: stranger.account }),
      "BadSigner",
    );

    // A valid signature for a DIFFERENT destination is just as useless.
    const elsewhere = await authorise(signerAccount, id, stranger.account.address, deadline);
    await expectRevert(
      () => gift.write.claim([id, recipientAddress, deadline, elsewhere], { account: stranger.account }),
      "BadSigner",
    );
  });

  it("refuses an expired authorisation", async () => {
    const id = giftId(6);
    await createGift(id);
    await increaseTime(31 * DAY);

    const deadline = (await now()) - 1n;
    const signature = await authorise(signerAccount, id, recipientAddress, deadline);
    await expectRevert(
      () => gift.write.claim([id, recipientAddress, deadline, signature], { account: stranger.account }),
      "AuthorisationExpired",
    );
  });

  it("moves every token to the recipient after the unlock date, once", async () => {
    const id = giftId(7);
    await createGift(id);
    await increaseTime(31 * DAY);
    assert.equal(await gift.read.isClaimable([id]), true);

    const deadline = (await now()) + 600n;
    const signature = await authorise(signerAccount, id, recipientAddress, deadline);
    // Submitted by a third party — the sponsored user op is not the giver's.
    await gift.write.claim([id, recipientAddress, deadline, signature], { account: stranger.account });

    assert.equal(await tokenA.read.balanceOf([recipientAddress]), 3n * ONE_TOKEN);
    assert.equal(await tokenB.read.balanceOf([recipientAddress]), 2n * ONE_TOKEN);
    assert.equal(await tokenA.read.balanceOf([gift.address]), 0n);
    assert.equal(await tokenB.read.balanceOf([gift.address]), 0n);

    const stored = await gift.read.getGift([id]);
    assert.equal(stored.claimed, true);
    assert.equal(await gift.read.isClaimable([id]), false);

    // The same authorisation, replayed.
    await expectRevert(
      () => gift.write.claim([id, recipientAddress, deadline, signature], { account: stranger.account }),
      "AlreadyClaimed",
    );
  });

  it("refuses a reclaim before the grace period, and by anyone but the giver", async () => {
    const id = giftId(8);
    await createGift(id);

    await expectRevert(() => gift.write.reclaim([id], { account: giver.account }), "NotYetReclaimable");

    await increaseTime(61 * DAY);
    await expectRevert(() => gift.write.reclaim([id], { account: stranger.account }), "NotGiver");
  });

  it("returns the tokens to the giver after the grace period", async () => {
    const id = giftId(9);
    await createGift(id);
    await increaseTime(61 * DAY);

    await gift.write.reclaim([id], { account: giver.account });

    assert.equal(await tokenA.read.balanceOf([giver.account.address]), 100n * ONE_TOKEN);
    assert.equal(await tokenB.read.balanceOf([giver.account.address]), 100n * ONE_TOKEN);
    assert.equal(await tokenA.read.balanceOf([gift.address]), 0n);
    assert.equal((await gift.read.getGift([id])).claimed, true);

    // A reclaimed gift is closed for good, both ways.
    await expectRevert(() => gift.write.reclaim([id], { account: giver.account }), "AlreadyClaimed");
    const deadline = (await now()) + 600n;
    const signature = await authorise(signerAccount, id, recipientAddress, deadline);
    await expectRevert(
      () => gift.write.claim([id, recipientAddress, deadline, signature], { account: stranger.account }),
      "AlreadyClaimed",
    );
  });

  it("knows nothing about an id that was never created", async () => {
    const id = giftId(99);
    assert.equal(await gift.read.isClaimable([id]), false);
    assert.equal((await gift.read.getGift([id])).from, "0x0000000000000000000000000000000000000000");

    const deadline = (await now()) + 600n;
    const signature = await authorise(signerAccount, id, recipientAddress, deadline);
    await expectRevert(
      () => gift.write.claim([id, recipientAddress, deadline, signature], { account: stranger.account }),
      "GiftUnknown",
    );
    await expectRevert(() => gift.write.reclaim([id], { account: giver.account }), "GiftUnknown");
  });

  it("lets the owner rotate the attestation key, and nobody else", async () => {
    assert.equal(
      (await gift.read.signer()).toLowerCase(),
      signerAccount.address.toLowerCase(),
    );
    await expectRevert(
      () => gift.write.setSigner([impostorAccount.address], { account: stranger.account }),
      "OwnableUnauthorizedAccount",
    );
    await gift.write.setSigner([impostorAccount.address], { account: giver.account });
    assert.equal((await gift.read.signer()).toLowerCase(), impostorAccount.address.toLowerCase());
  });
});
