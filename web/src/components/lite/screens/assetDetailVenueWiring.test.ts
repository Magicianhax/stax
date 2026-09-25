import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// AssetDetailScreen is a component: it can't be imported (no jsdom/testing-library — see
// vitest.config.mts) or rendered here to catch a wiring mistake behaviorally. This is a
// regression guard for exactly the class of bug a render test would normally catch: two props
// that must always agree drifting apart because one was wired to the wrong local variable.
//
// Reviewer-found regression: `chosenVenue` (the value the Buy button actually uses, via
// `go("trade", { venue: chosenVenue })`) already honours `openedVenue` (a board row's or a twin
// holding's issuer), but `VenuePicker`'s ring was still fed `bestVenue={defaultVenue ?? null}` —
// the catalog's own best-gap pick, which VenuePicker also uses for its ring until an explicit
// tap. Whenever the cheapest-price issuer (`chosenVenue`, e.g. from a "Which is cheaper?" row)
// differs from the smallest-gap issuer (`defaultVenue`), the ring highlighted one issuer while
// Buy bought the other. VenuePicker now takes a `selected` prop that its ring prefers over
// `bestVenue`, so the ring follows `chosenVenue` while "Best right now" keeps tagging the
// catalog's own pick.
const source = readFileSync(
  fileURLToPath(new URL("./AssetDetailScreen.tsx", import.meta.url)),
  "utf8",
);

describe("AssetDetailScreen venue wiring", () => {
  it("feeds VenuePicker's ring the same venue the Buy button targets", () => {
    expect(source).toMatch(/<VenuePicker\b[^>]*selected=\{chosenVenue \?\? null\}/);
  });

  it("never regresses to feeding the ring the catalog default instead of the chosen venue", () => {
    expect(source).not.toMatch(/<VenuePicker\b[^>]*bestVenue=\{defaultVenue\b/);
  });

  it("Buy still targets chosenVenue, so both readers stay pinned to the one variable", () => {
    expect(source).toMatch(/go\("trade",\s*\{\s*symbol:\s*asset\.symbol,\s*side:\s*"buy",\s*venue:\s*bsc \? chosenVenue : undefined/);
  });
});
