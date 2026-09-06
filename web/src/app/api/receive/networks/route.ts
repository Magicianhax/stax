// GET /api/receive/networks — the curated networks + tokens a deposit address can be made for.
//   → { networks: [{ id, key, name, vm, tokens: [{ address, symbol, name, decimals }] }] }
// Public; Relay's chain list is cached in-process for 1 h and at the edge for the same.
import type { NetworksResponse } from "@/lib/receive";
import { curatedNetworks, getChains } from "@/lib/server/relay";
import { serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const body: NetworksResponse = { networks: curatedNetworks(await getChains()) };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    return serverError("receive-networks", err, 502);
  }
}
