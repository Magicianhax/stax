// Deterministic fake transaction hashes for the demo: 32 bytes of hex that look like a hash
// instead of one repeated word, and are the same every time for the same tag. Nothing here is
// ever broadcast; these only fill receipts and links.
export function hx(tag: string): `0x${string}` {
  let h = 2166136261;
  for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 16777619);
  let out = "";
  for (let i = 0; i < 8; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return `0x${out}`;
}
