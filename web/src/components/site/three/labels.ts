// Canvas-drawn textures for the prototype scenes (coin faces, chip labels,
// pillar tops, the plan document). Fonts resolve through the next/font CSS
// variables so the canvas uses Hanken / Fraunces / JetBrains once loaded.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from "three";

function cssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function uiFamily(): string {
  const v = cssVar("--font-hanken");
  return v ? `${v}, system-ui, sans-serif` : "system-ui, sans-serif";
}

export function displayFamily(): string {
  const v = cssVar("--font-fraunces");
  return v ? `${v}, Georgia, serif` : "Georgia, serif";
}

export function monoFamily(): string {
  const v = cssVar("--font-jetbrains");
  return v ? `${v}, ui-monospace, monospace` : "ui-monospace, monospace";
}

/** Resolves once the three families are usable on a canvas (or immediately if they never will be). */
export async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`700 40px ${uiFamily()}`),
      document.fonts.load(`500 40px ${uiFamily()}`),
      document.fonts.load(`500 40px ${displayFamily()}`),
      document.fonts.load(`400 40px ${monoFamily()}`),
    ]);
  } catch {
    // A missing font is not an error: the system faces draw the label.
  }
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return { canvas, ctx };
}

export function toTexture(canvas: HTMLCanvasElement, anisotropy = 4): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
