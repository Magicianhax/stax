// ERC-8021 attribution, so the volume Stax sends on Base is credited to us.
//
// The trick the standard leans on: the EVM hands a contract whatever calldata it
// was given, and Solidity's ABI decoder ignores anything past the arguments it
// expected. So a few bytes appended to the end of a call change nothing on chain
// and are read afterwards by off-chain indexers. Nothing here touches what the
// transaction actually does.
//
// Schema 0, the canonical one, laid out in the order the bytes appear:
//
//   [codes: ASCII, comma delimited][codesLength: 1 byte][schemaId: 0x00][marker: 16 bytes]
//
// Every field is ordered for a parser reading BACKWARDS from the end of the
// calldata, which is the only direction that works when the suffix sits behind
// arguments of unknown length: marker, then schema, then the length, and only
// then does it know how far back the codes reach. Putting the length first —
// as one widely copied write-up of the spec does — leaves it unfindable.
//
// The test pins this against the exact string Base's own dashboard generates for
// our code, which is the only authority worth trusting here.
import { concatHex, type Hex } from "viem";

/** 0x8021 eight times. The fixed tail every parser looks for first. */
const MARKER = "8021".repeat(8);

/** Schema 0: a comma-delimited list of ASCII codes behind a one-byte length. */
const SCHEMA_ID = "00";

/** One byte holds the length, so this is the ceiling on the joined string. */
const MAX_CODES_BYTES = 255;

/**
 * The suffix for `codes`, or null when there is nothing to attribute.
 *
 * Returns null rather than throwing on anything it cannot encode: a malformed
 * builder code is a misconfiguration, and refusing to send someone's investment
 * over an attribution tag would be the wrong trade. The console warning is the
 * signal; the transaction goes out either way.
 */
export function attributionSuffix(codes: string[]): Hex | null {
  const joined = codes
    .map((c) => c.trim())
    .filter(Boolean)
    .join(",");
  if (!joined) return null;

  // ASCII only. A multi-byte character would make the length byte lie.
  if (!/^[\x21-\x7e]+$/.test(joined)) {
    console.warn(`[attribution] builder code is not printable ASCII, skipping: ${joined}`);
    return null;
  }
  const bytes = new TextEncoder().encode(joined);
  if (bytes.length > MAX_CODES_BYTES) {
    console.warn(`[attribution] builder codes too long (${bytes.length} bytes), skipping`);
    return null;
  }

  const hex = (n: number) => n.toString(16).padStart(2, "0");
  const body = Array.from(bytes, hex).join("");
  return `0x${body}${hex(bytes.length)}${SCHEMA_ID}${MARKER}`;
}

/**
 * The suffix for a given chain, from the environment.
 *
 * Builder codes are a Base program, so this is Base only: appending unknown
 * bytes to Mantle traffic would buy nothing and risk something. Unset means no
 * suffix, which is how it stays off until the code is configured.
 */
export function builderCodeSuffix(chainKey: string): Hex | null {
  if (chainKey !== "base") return null;
  const code = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE?.trim();
  return code ? attributionSuffix([code]) : null;
}

/** The part of a smart account this touches: how a batch of calls becomes callData. */
export interface Encoder {
  encodeCalls: (calls: never) => Promise<Hex>;
}

/**
 * Append the builder-code suffix to everything an account sends on `chainKey`.
 *
 * The suffix goes on the account's own callData, which is the closest thing a
 * user operation has to transaction calldata: the bundler's `handleOps` call
 * belongs to the bundler, not to us. SimpleAccount decodes `executeBatch` out of
 * that callData and ignores the bytes past it, so execution is untouched.
 *
 * Wrapping the encoder rather than each call site matters. `prepareUserOperation`
 * and `sendUserOperation` both go through it, so the gas is estimated over the
 * same bytes that are eventually signed.
 *
 * Never throws. Attribution is worth having and is never worth failing someone's
 * investment over, so a frozen or unusual account object leaves the send alone.
 * Returns whether the tag was attached, which is what the tests assert on.
 */
export function tagUserOps(account: Encoder, chainKey: string): boolean {
  const suffix = builderCodeSuffix(chainKey);
  if (!suffix) return false;
  try {
    const encode = account.encodeCalls.bind(account);
    account.encodeCalls = async (calls: never) => concatHex([await encode(calls), suffix]);
    return true;
  } catch (e) {
    console.warn("[attribution] could not tag user ops:", e instanceof Error ? e.message : e);
    return false;
  }
}
