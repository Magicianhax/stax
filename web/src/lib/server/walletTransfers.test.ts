// Unit tests for the response mappings only — Zerion and the Etherscan/Blockscout
// dialect in, `WalletTx[]` out. Nothing here touches the network or Redis.
//
// The Zerion fixture is cut from a real Base response for
// 0x01bF470AeC5d9c8586b283D8C952bAfCE71275d5 on 2026-09-08, not from the docs.
// `implementations` is trimmed to two chains rather than one, because Zerion lists
// the same asset on every chain it knows and the mapping has to pick ours.
import { describe, expect, it } from "vitest";
import { getChain } from "@/lib/chains";
import { mapZerionTransfers, type ZPage } from "@/lib/server/zerion";
import { knownTokens, parseExplorerTransfers } from "@/lib/server/walletTransfers";

const BASE = getChain("base");
const WALLET = "0x01bf470aec5d9c8586b283d8c952bafce71275d5";
const COUNTERPARTY = "0xed08d94c2722083b0b742ef9b55e81046c54deb3";
const USDC = BASE.usdc.address.toLowerCase();
const ABASUSDC = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab";
const NVDA_TOKEN = "0xb20000000000000000000078ee7ce2fe4908108c";
const META_TOKEN = "0xb2000000000000000000008bc8786b856e61707c";
const HASH_TRADE = "0x816bc7fad8c70d09dee3dc13573ebf17c3d13bf0b8f2f0aaa9309d07d2e403e4";
const HASH_SUPPLY = "0x38859edbfe00000000000000000000000000000000000000000000000000beef";
const HASH_RECEIVE = "0xda903bf6097dd4369194649647251938939eb48fa314edbca9e69a76ace67791";
const HASH_APPROVE = "0x6dd0f417bb00000000000000000000000000000000000000000000000000cafe";

const tokens = knownTokens(BASE);

/** USDC as Zerion returns it: the same asset on many chains, ours among them. */
const usdcInfo = {
  symbol: "USDC",
  implementations: [
    { chain_id: "ethereum", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
    { chain_id: "base", address: BASE.usdc.address, decimals: 6 },
  ],
};

const zerionPage: ZPage = {
  links: { next: "https://api.zerion.io/v1/wallets/…/transactions/?page[after]=xyz" },
  data: [
    // An approval: an operation with no transfers at all. Not an error, just nothing to map.
    { attributes: { operation_type: "execute", hash: HASH_APPROVE, mined_at_block: 51009529, mined_at: "2026-09-07T19:00:00Z", status: "confirmed", transfers: [] } },
    {
      attributes: {
        operation_type: "receive",
        hash: HASH_RECEIVE,
        mined_at_block: 51008233,
        mined_at: "2026-09-07T18:30:13Z",
        status: "confirmed",
        transfers: [
          {
            fungible_info: usdcInfo,
            direction: "in",
            quantity: { int: "99903431", decimals: 6, float: 99.903431, numeric: "99.903431" },
            value: 99.89789974663927,
            sender: "0xf70DA97812CB96acDF810712Aa562db8dfA3dBEF",
            recipient: WALLET,
          },
        ],
      },
    },
    // An Aave supply. Zerion calls it `execute`, and the aToken has NO price: value is null.
    {
      attributes: {
        operation_type: "execute",
        hash: HASH_SUPPLY,
        mined_at_block: 50989920,
        mined_at: "2026-09-07T08:15:00Z",
        status: "confirmed",
        transfers: [
          {
            fungible_info: usdcInfo,
            direction: "out",
            quantity: { int: "2500", decimals: 6, float: 0.0025, numeric: "0.002500" },
            value: 0.0025005644235,
            sender: WALLET,
            recipient: COUNTERPARTY,
          },
          {
            fungible_info: { symbol: "aBasUSDC", implementations: [{ chain_id: "base", address: ABASUSDC, decimals: 6 }] },
            direction: "in",
            quantity: { int: "997499", decimals: 6, float: 0.997499, numeric: "0.997499" },
            value: null,
            sender: COUNTERPARTY,
            recipient: WALLET,
          },
        ],
      },
    },
    // A trade: one transaction, several transfers — the USDC out and every asset in.
    {
      attributes: {
        operation_type: "trade",
        hash: HASH_TRADE,
        mined_at_block: 50989664,
        mined_at: "2026-09-07T08:11:15Z",
        status: "confirmed",
        transfers: [
          {
            fungible_info: {
              symbol: "NVDAx",
              implementations: [
                { chain_id: "ethereum", address: "0x00000000000000000000000000000000deadbeef", decimals: 18 },
                { chain_id: "base", address: NVDA_TOKEN, decimals: 8 },
              ],
            },
            direction: "in",
            quantity: { int: "1072092", decimals: 8, float: 0.01072092, numeric: "0.01072092" },
            value: 2.493435388637065,
            sender: COUNTERPARTY,
            recipient: WALLET,
          },
          {
            fungible_info: { symbol: "METAx", implementations: [{ chain_id: "base", address: META_TOKEN, decimals: 8 }] },
            direction: "in",
            quantity: { int: "203228", decimals: 8, float: 0.00203228, numeric: "0.00203228" },
            value: 1.2467738171015657,
            sender: COUNTERPARTY,
            recipient: WALLET,
          },
          {
            fungible_info: usdcInfo,
            direction: "out",
            quantity: { int: "4987500", decimals: 6, float: 4.9875, numeric: "4.987500" },
            value: 4.98736384274625,
            sender: WALLET,
            recipient: COUNTERPARTY,
          },
        ],
      },
    },
  ],
};

describe("mapZerionTransfers", () => {
  const txs = mapZerionTransfers(zerionPage, "base", tokens);

  it("returns one row per transfer, so a trade yields several", () => {
    expect(txs).toHaveLength(6); // 1 receive + 2 supply + 3 trade; the approval contributes none
    expect(txs.filter((t) => t.hash === HASH_TRADE)).toHaveLength(3);
  });

  it("maps a receive", () => {
    expect(txs.find((t) => t.hash === HASH_RECEIVE)).toEqual({
      hash: HASH_RECEIVE,
      direction: "in",
      symbol: "USDC",
      amount: 99.903431,
      counterparty: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
      tokenAddress: USDC,
      blockNumber: 51008233,
      timestamp: Math.floor(Date.parse("2026-09-07T18:30:13Z") / 1000),
    });
  });

  it("maps a transfer whose value is null (an aToken has no price)", () => {
    const supplied = txs.find((t) => t.tokenAddress === ABASUSDC);
    expect(supplied).toBeDefined();
    expect(supplied?.direction).toBe("in");
    expect(supplied?.amount).toBe(0.997499);
    expect(supplied?.symbol).toBe(tokens.get(ABASUSDC)?.symbol ?? "aBasUSDC");
  });

  it("picks the implementation for this chain, never the first one listed", () => {
    const paid = txs.find((t) => t.hash === HASH_TRADE && t.direction === "out");
    expect(paid?.tokenAddress).toBe(USDC); // Base USDC, not Ethereum's
    expect(paid?.amount).toBe(4.9875);
    const nvda = txs.find((t) => t.hash === HASH_TRADE && t.direction === "in");
    expect(nvda?.tokenAddress).toBe(NVDA_TOKEN);
  });

  it("takes the symbol from our token map, falling back to Zerion's", () => {
    const nvda = txs.find((t) => t.tokenAddress === NVDA_TOKEN);
    expect(nvda?.symbol).toBe(tokens.get(NVDA_TOKEN)?.symbol ?? "NVDAx");
    const unknown = mapZerionTransfers(
      {
        data: [
          {
            attributes: {
              hash: HASH_RECEIVE,
              mined_at_block: 1,
              status: "confirmed",
              transfers: [
                {
                  fungible_info: { symbol: "PEPE", implementations: [{ chain_id: "base", address: "0x00000000000000000000000000000000000000ff", decimals: 18 }] },
                  direction: "in",
                  quantity: { int: "2000000000000000000", decimals: 18 },
                  sender: COUNTERPARTY,
                  recipient: WALLET,
                },
              ],
            },
          },
        ],
      },
      "base",
      tokens,
    );
    expect(unknown[0].symbol).toBe("PEPE");
    expect(unknown[0].amount).toBe(2);
  });

  it("reads direction and counterparty from the transfer itself", () => {
    const out = txs.find((t) => t.hash === HASH_TRADE && t.direction === "out");
    expect(out?.counterparty).toBe(COUNTERPARTY);
    const inbound = txs.find((t) => t.hash === HASH_TRADE && t.direction === "in");
    expect(inbound?.counterparty).toBe(COUNTERPARTY);
  });

  it("skips what it cannot map instead of guessing", () => {
    const page: ZPage = {
      data: [
        { attributes: { hash: HASH_RECEIVE, mined_at_block: 1, status: "pending", transfers: [] } },
        { attributes: { hash: "not-a-hash", mined_at_block: 1, status: "confirmed", transfers: [] } },
        { attributes: { hash: HASH_TRADE, status: "confirmed", transfers: [] } },
        {
          attributes: {
            hash: HASH_TRADE,
            mined_at_block: 42,
            status: "confirmed",
            transfers: [
              { nft_info: { token_id: "1" }, direction: "in", quantity: { int: "1", decimals: 0 }, sender: WALLET, recipient: WALLET },
              { fungible_info: usdcInfo, direction: "self", quantity: { int: "1", decimals: 6 }, sender: WALLET, recipient: WALLET },
              {
                fungible_info: { symbol: "SOL", implementations: [{ chain_id: "solana", address: "So111", decimals: 9 }] },
                direction: "in",
                quantity: { int: "1", decimals: 9 },
                sender: COUNTERPARTY,
                recipient: WALLET,
              },
              { fungible_info: usdcInfo, direction: "in", quantity: { int: "1", decimals: 6 }, recipient: WALLET },
              { fungible_info: usdcInfo, direction: "in", sender: COUNTERPARTY, recipient: WALLET },
            ],
          },
        },
      ],
    };
    expect(mapZerionTransfers(page, "base", tokens)).toEqual([]);
  });

  it("never throws on a payload of the wrong shape", () => {
    for (const bad of [undefined, null, {}, { data: null }, { data: "nope" }, { data: [null, 7, { attributes: "x" }] }]) {
      expect(mapZerionTransfers(bad as ZPage, "base", tokens)).toEqual([]);
    }
  });
});

// ── Etherscan V2 / Blockscout `account/tokentx` ────────────────────────────────
function esRow(over: Record<string, string> = {}) {
  return {
    hash: HASH_RECEIVE,
    from: "0xEd08d94c2722083b0B742ef9b55e81046C54DEb3",
    to: WALLET,
    value: "1500000",
    contractAddress: BASE.usdc.address,
    tokenSymbol: "USD Coin",
    tokenDecimal: "6",
    blockNumber: "50989664",
    timeStamp: "1757232675",
    ...over,
  };
}

describe("parseExplorerTransfers", () => {
  it("maps an Etherscan V2 payload, preferring our registry symbol", () => {
    expect(parseExplorerTransfers(BASE, WALLET, { status: "1", message: "OK", result: [esRow()] })).toEqual([
      {
        hash: HASH_RECEIVE,
        direction: "in",
        symbol: "USDC", // our label, not the on-chain "USD Coin"
        amount: 1.5,
        counterparty: COUNTERPARTY,
        tokenAddress: USDC,
        blockNumber: 50989664,
        timestamp: 1757232675,
      },
    ]);
  });

  it("reads direction from the wallet, not the payload", () => {
    const [out] = parseExplorerTransfers(BASE, WALLET, {
      status: "1",
      result: [esRow({ from: WALLET, to: "0xEd08d94c2722083b0B742ef9b55e81046C54DEb3" })],
    });
    expect(out.direction).toBe("out");
    expect(out.counterparty).toBe(COUNTERPARTY);
  });

  it("accepts Blockscout's dialect (message OK, no status field)", () => {
    const txs = parseExplorerTransfers(BASE, WALLET, { message: "OK", result: [esRow()] });
    expect(txs).toHaveLength(1);
    expect(txs[0].symbol).toBe("USDC");
  });

  it("falls back to the on-chain symbol and decimals for an unknown token", () => {
    const [tx] = parseExplorerTransfers(BASE, WALLET, {
      status: "1",
      result: [
        esRow({ contractAddress: "0x00000000000000000000000000000000000000ff", tokenSymbol: "PEPE", tokenDecimal: "18", value: "2000000000000000000" }),
      ],
    });
    expect(tx.symbol).toBe("PEPE");
    expect(tx.amount).toBe(2);
  });

  it("returns newest first and honours the cap", () => {
    const rows = [
      esRow({ hash: HASH_RECEIVE, blockNumber: "10" }),
      esRow({ hash: HASH_TRADE, blockNumber: "99" }),
      esRow({ hash: HASH_SUPPLY, blockNumber: "50" }),
    ];
    const txs = parseExplorerTransfers(BASE, WALLET, { status: "1", result: rows }, 2);
    expect(txs.map((t) => t.blockNumber)).toEqual([99, 50]);
  });

  it("collapses a transfer the explorer repeats within one transaction", () => {
    const txs = parseExplorerTransfers(BASE, WALLET, { status: "1", result: [esRow(), esRow()] });
    expect(txs).toHaveLength(1);
  });

  it("treats an empty history as an answer, not a failure", () => {
    expect(parseExplorerTransfers(BASE, WALLET, { status: "0", message: "No transactions found", result: [] })).toEqual([]);
    expect(parseExplorerTransfers(BASE, WALLET, { status: "0", message: "NOTOK", result: "No transactions found" })).toEqual([]);
  });

  it("throws on an error payload so the next source is tried", () => {
    expect(() => parseExplorerTransfers(BASE, WALLET, { status: "0", message: "NOTOK", result: "Max rate limit reached" })).toThrow(/Max rate limit/);
    expect(() => parseExplorerTransfers(BASE, WALLET, { message: "Something went wrong" })).toThrow();
  });
});
