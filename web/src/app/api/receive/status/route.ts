// GET /api/receive/status?address= — recent deposits at one of the caller's deposit addresses.
//   → { deposits: [{ id, status, amountUsd, originTx, destinationTx, createdAt }] }
// 403 unless the address was minted for the caller (unknown addresses look the same).
// Polled every 6 s by the sheet, so the limit is generous. See docs/RECEIVE.md.
import type { NextRequest } from "next/server";
import type { DepositStatusResponse } from "@/lib/receive";
import { findOwnedDepositAddress } from "@/lib/server/depositAddresses";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { depositsFor, RelayUnavailable } from "@/lib/server/relay";
import { badRequest, jsonError, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = await rateLimit(`receive-status:${user.userId}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!address || address.length > 128) return badRequest("Missing address.");

  try {
    const row = await findOwnedDepositAddress(user.userId, address);
    if (!row) return jsonError(403, "That address isn't yours.", NO_STORE);
    const body: DepositStatusResponse = { deposits: await depositsFor(row.address) };
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RelayUnavailable) return serverError("receive-status", err, 502);
    return serverError("receive-status", err);
  }
}
