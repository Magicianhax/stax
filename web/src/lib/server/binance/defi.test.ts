// The DeFi API wrappers Savings needs: the current Venus USDT rate, and unsigned deposit/redeem
// calldata. Fixtures are LIVE captures from docs/BINANCE-WEB3.md's DeFi section research
// (2026-09-25) except where a fixture's own `_note` says otherwise (Binance didn't return every
// shape live — see defi_build_deposit_with_approve.json and defi_build_redeem.json).
//
// `defi_redeem_no_position.json` (the raw `{code:40456,...}` wire envelope Binance actually
// returned) isn't imported below: `web3Request` is mocked here, and the real code->throw mapping
// it documents belongs to client.ts's own tests. It's kept as the literal record docs/BINANCE-
// WEB3.md's DeFi section quotes from, so the doc's "LIVE" claim points at a checked-in artifact.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({ web3Request: vi.fn() }));

import { web3Request } from "./client";
import investmentDetailFixture from "./__fixtures__/defi_investment_detail.json";
import buildDepositFixture from "./__fixtures__/defi_build_deposit.json";
import buildDepositWithApproveFixture from "./__fixtures__/defi_build_deposit_with_approve.json";
import buildRedeemFixture from "./__fixtures__/defi_build_redeem.json";

const mockWeb3Request = vi.mocked(web3Request);
const ADDR = "0xF977814e90dA44bFA03b6295A0616a897441aceC" as const;
const USDT_INVESTMENT_ID = "5b77bfd8d8f7c18e9ee0d8f331c4d78f56744eed8addbe2e9970c0ef37e763cb";

beforeEach(() => {
  mockWeb3Request.mockReset();
});

describe("investmentDetail", () => {
  it("parses the Venus USDT investment (LIVE shape)", async () => {
    mockWeb3Request.mockResolvedValueOnce(investmentDetailFixture);
    const { investmentDetail } = await import("./defi");
    const detail = await investmentDetail(USDT_INVESTMENT_ID);
    expect(detail.investable).toBe(true);
    expect(detail.apyBps).toBe(338);
    expect(detail.apyDisplay).toBe("3.38%");
    expect(detail.assetToken?.symbol).toBe("USDT");
    expect(mockWeb3Request).toHaveBeenCalledWith("POST", "/api/v1/defi/data/investment/detail", {}, { investmentId: USDT_INVESTMENT_ID });
  });

  it("throws on an unrecognized response shape rather than returning a half-parsed rate", async () => {
    mockWeb3Request.mockResolvedValueOnce({ nonsense: true });
    const { investmentDetail } = await import("./defi");
    await expect(investmentDetail(USDT_INVESTMENT_ID)).rejects.toThrow();
  });
});

describe("buildDeposit", () => {
  it("parses a single-call [DEPOSIT] response (LIVE: this wallet already had allowance)", async () => {
    mockWeb3Request.mockResolvedValueOnce(buildDepositFixture);
    const { buildDeposit } = await import("./defi");
    const calls = await buildDeposit({
      address: ADDR,
      investmentId: USDT_INVESTMENT_ID,
      tokenAddress: "0x55d398326f99059fF775485246999027B3197955",
      amountHuman: "6",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].to.toLowerCase()).toBe("0xfd5840cd36d94d7229439859c0112a4185bc0255");
    expect(calls[0].data.startsWith("0xa0712d68")).toBe(true); // mint(uint256) selector
    expect(calls[0].value).toBe("0"); // hex "0x0" -> decimal-string wei, like every other ExecCall
  });

  it("parses a two-call [APPROVE, DEPOSIT] response, preserving order", async () => {
    mockWeb3Request.mockResolvedValueOnce(buildDepositWithApproveFixture);
    const { buildDeposit } = await import("./defi");
    const calls = await buildDeposit({
      address: ADDR,
      investmentId: USDT_INVESTMENT_ID,
      tokenAddress: "0x55d398326f99059fF775485246999027B3197955",
      amountHuman: "6",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].to.toLowerCase()).toBe("0x55d398326f99059ff775485246999027b3197955"); // approve on USDT
    expect(calls[1].to.toLowerCase()).toBe("0xfd5840cd36d94d7229439859c0112a4185bc0255"); // deposit on vUSDT
  });

  it("sends the human decimal amount, not raw units — Binance's own API, not units.ts", async () => {
    mockWeb3Request.mockResolvedValueOnce(buildDepositFixture);
    const { buildDeposit } = await import("./defi");
    await buildDeposit({ address: ADDR, investmentId: USDT_INVESTMENT_ID, tokenAddress: "0x55d398326f99059fF775485246999027B3197955", amountHuman: "6" });
    const body = mockWeb3Request.mock.calls[0][3] as { token: { amount: string } };
    expect(body.token.amount).toBe("6");
  });
});

describe("buildRedeem", () => {
  it("parses a [REDEEM] response", async () => {
    mockWeb3Request.mockResolvedValueOnce(buildRedeemFixture);
    const { buildRedeem } = await import("./defi");
    const calls = await buildRedeem({ address: ADDR, investmentId: USDT_INVESTMENT_ID, ratio: "1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].to.toLowerCase()).toBe("0xfd5840cd36d94d7229439859c0112a4185bc0255");
  });

  it("surfaces Binance's business-error envelope (LIVE: 'no position found') as a BinanceWeb3Error", async () => {
    const { BinanceWeb3Error } = await import("./types");
    mockWeb3Request.mockRejectedValueOnce(new BinanceWeb3Error(40456, "no position found for investmentId=" + USDT_INVESTMENT_ID, 200));
    const { buildRedeem } = await import("./defi");
    await expect(buildRedeem({ address: ADDR, investmentId: USDT_INVESTMENT_ID, ratio: "1" })).rejects.toThrow(/no position found/);
  });
});
