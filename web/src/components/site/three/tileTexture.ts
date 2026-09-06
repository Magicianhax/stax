// The face of a share tile: the ticker, the company name and a thin rule,
// drawn locally onto a canvas (no image URLs, nothing to fetch). Colors come
// from the site tokens so the label follows the theme; the font is the same
// Hanken Grotesk next/font loads for the page, resolved through its CSS
// variable so the canvas never falls back to a system face once it is ready.
import { CanvasTexture, SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter } from "three";

export const LABEL_W = 1024;
export const LABEL_H = 597;

export interface LabelPalette {
  /** Primary text color (`--s-ink`). */
  ink: string;
  /** Secondary text color (`--s-ink-2`). */
  ink2: string;
  /** Rule color (`--s-line` or a mix of ink). */
  line: string;
}

/** The UI font stack the page uses, read from the next/font variable. */
export function siteUiFamily(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-hanken").trim();
  return v ? `${v}, system-ui, sans-serif` : "system-ui, sans-serif";
}

/** Resolves once Hanken 700 is usable on a canvas (or immediately if it never will be). */
export async function ensureLabelFont(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const family = siteUiFamily();
  try {
    await Promise.all([document.fonts.load(`700 200px ${family}`), document.fonts.load(`500 77px ${family}`)]);
  } catch {
    // A missing font is not an error: the system sans draws the label.
  }
}

export function makeTileLabel(ticker: string, company: string, p: LabelPalette, anisotropy = 4): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_W;
  canvas.height = LABEL_H;
  const ctx = canvas.getContext("2d");
  const family = siteUiFamily();
  if (ctx) {
    ctx.clearRect(0, 0, LABEL_W, LABEL_H);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Ticker: the loud element, tight tracking approximated by drawing glyph by glyph.
    ctx.fillStyle = p.ink;
    ctx.font = `700 200px ${family}`;
    drawTracked(ctx, ticker, 75, 261, -7);

    // Company name, quieter. Large enough to survive the foreshortening.
    ctx.fillStyle = p.ink2;
    ctx.font = `500 77px ${family}`;
    drawTracked(ctx, company, 77, 376, -0.7);

    // Thin rule near the bottom.
    ctx.fillStyle = p.line;
    ctx.fillRect(75, 496, LABEL_W - 150, 4);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}
