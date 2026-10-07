// Puts the active network in the URL of a same-origin GET to our API.
//
// Routes learn the chain from `?chain=` or the `x-stax-chain` header, but the edge cache keys
// responses by URL alone. A cached GET that only carried the header could be filled with BNB
// Chain data and then served to a Base or Mantle client asking for the same URL inside the cache
// window (wrong prices, wrong Vera record). With the chain in the URL each network gets its own
// cache entry, the same way /api/rwa already does it.
export function withChainParam(input: string, chainKey: string, method: string = "GET"): string {
  if (method.toUpperCase() !== "GET" || !input.startsWith("/api/")) return input;
  const hash = input.indexOf("#");
  const base = hash === -1 ? input : input.slice(0, hash);
  const frag = hash === -1 ? "" : input.slice(hash);
  const q = base.indexOf("?");
  const path = q === -1 ? base : base.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : base.slice(q + 1));
  if (params.has("chain")) return input;
  params.set("chain", chainKey);
  return `${path}?${params.toString()}${frag}`;
}
