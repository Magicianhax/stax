"use client";

// AXIS: proof as the object. A floating glass slab leans back like a document
// on a desk and carries Vera's plan (title, four holdings, the risk line, a
// signature line). The signature draws itself, a terracotta wax seal drops
// and lands with a small squash (the slab dips on impact), then a faint
// "Verified on-chain" line fades in. Holds five seconds, then restarts.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei/core/RoundedBox";
import gsap from "gsap";
import { Group, MathUtils, type CanvasTexture } from "three";
import { displayFor } from "@/lib/displayAssets";
import { Stage, Lights, type SceneProps } from "./Stage";
import { displayFamily, makeCanvas, monoFamily, roundRect, toTexture, uiFamily } from "./labels";
import type { Theme } from "./theme";

const SLAB_W = 2.4;
const SLAB_H = 1.5;
const SLAB_T = 0.08;
const DOC_W = 2.3;
const DOC_H = DOC_W / 1.6;
const CW = 1024;
const CH = 640;
const LEAN = MathUtils.degToRad(-18);

const ROWS = [
  { symbol: "NVDA", pct: 30 },
  { symbol: "AAPL", pct: 30 },
  { symbol: "GOOGL", pct: 25 },
  { symbol: "aUSDC", pct: 15 },
];

// Seal rests over the right end of the signature line.
const SEAL_X = (820 / CW - 0.5) * DOC_W;
const SEAL_Y = (0.5 - 528 / CH) * DOC_H;
const SEAL_Z = SLAB_T / 2 + 0.03;
const SEAL_DROP = 2.3; // starts above the frame

// ------------------------------------------------------------- signature --

// A cursive flourish reading as "Vera", in a 440×90 box.
const SIG: [number, number][] = [
  [0, 22], [16, 58], [36, 88], [58, 52], [76, 10], [84, 30], [100, 64], [122, 72], [142, 56],
  [128, 40], [112, 52], [124, 74], [152, 76], [174, 60], [188, 70], [204, 58], [214, 72],
  [240, 60], [256, 46], [244, 38], [228, 52], [238, 74], [266, 74], [304, 56], [344, 62],
  [400, 42], [440, 30],
];

function catmull(points: [number, number][], samples = 14): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

const SIG_PATH = catmull(SIG);
const SIG_LEN: number[] = [0];
for (let i = 1; i < SIG_PATH.length; i++) {
  const [ax, ay] = SIG_PATH[i - 1];
  const [bx, by] = SIG_PATH[i];
  SIG_LEN.push(SIG_LEN[i - 1] + Math.hypot(bx - ax, by - ay));
}
const SIG_TOTAL = SIG_LEN[SIG_LEN.length - 1];

function drawSignature(ctx: CanvasRenderingContext2D, ox: number, oy: number, progress: number, ink: string) {
  if (progress <= 0) return;
  const target = SIG_TOTAL * Math.min(1, progress);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(SIG_PATH[0][0], SIG_PATH[0][1]);
  for (let i = 1; i < SIG_PATH.length; i++) {
    if (SIG_LEN[i] <= target) {
      ctx.lineTo(SIG_PATH[i][0], SIG_PATH[i][1]);
    } else {
      const [ax, ay] = SIG_PATH[i - 1];
      const [bx, by] = SIG_PATH[i];
      const f = (target - SIG_LEN[i - 1]) / (SIG_LEN[i] - SIG_LEN[i - 1]);
      ctx.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
      break;
    }
  }
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------- document --

function drawPlan(ctx: CanvasRenderingContext2D, theme: Theme, sig: number, verified: number) {
  const dark = theme.mode === "dark";
  const ui = uiFamily();
  const display = displayFamily();
  const mono = monoFamily();
  ctx.clearRect(0, 0, CW, CH);

  // Paper, faintly, so the plan reads over the glass.
  ctx.fillStyle = dark ? "rgba(22,27,20,0.86)" : "rgba(255,255,255,0.6)";
  roundRect(ctx, 0, 0, CW, CH, 26);
  ctx.fill();

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Title and the example tag.
  ctx.fillStyle = theme.ink;
  ctx.font = `500 62px ${display}`;
  ctx.fillText("Vera’s plan", 64, 104);
  ctx.textAlign = "right";
  ctx.font = `400 22px ${mono}`;
  ctx.fillStyle = theme.ink3;
  ctx.fillText("EXAMPLE", CW - 64, 96);

  // Holdings.
  ctx.textAlign = "left";
  const rowY = 178;
  const rowH = 60;
  ROWS.forEach((r, i) => {
    const y = rowY + i * rowH;
    const d = displayFor(r.symbol);
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(80, y - 12, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.ink;
    ctx.font = `500 32px ${ui}`;
    ctx.fillText(d.name, 108, y);
    ctx.textAlign = "right";
    ctx.font = `500 30px ${mono}`;
    ctx.fillStyle = theme.ink2;
    ctx.fillText(`${r.pct}%`, CW - 64, y);
    ctx.textAlign = "left";
    ctx.fillStyle = dark ? "rgba(255,255,255,0.1)" : "rgba(40,52,38,0.1)";
    ctx.fillRect(64, y + 16, CW - 128, 2);
  });

  // Risk line: label, a track filled to 35%, the number.
  const ry = rowY + ROWS.length * rowH + 22;
  ctx.fillStyle = theme.ink2;
  ctx.font = `500 26px ${ui}`;
  ctx.fillText("Risk", 64, ry);
  const tx = 150;
  const tw = CW - 64 - tx - 110;
  ctx.fillStyle = dark ? "rgba(255,255,255,0.12)" : "rgba(40,52,38,0.12)";
  roundRect(ctx, tx, ry - 16, tw, 10, 5);
  ctx.fill();
  ctx.fillStyle = theme.primary;
  roundRect(ctx, tx, ry - 16, tw * 0.35, 10, 5);
  ctx.fill();
  ctx.textAlign = "right";
  ctx.font = `500 26px ${mono}`;
  ctx.fillStyle = theme.ink2;
  ctx.fillText("35%", CW - 64, ry);
  ctx.textAlign = "left";

  // Signature line and caption.
  const sy = 574;
  ctx.fillStyle = dark ? "rgba(255,255,255,0.28)" : "rgba(40,52,38,0.28)";
  ctx.fillRect(64, sy, 560, 2);
  ctx.fillStyle = theme.ink3;
  ctx.font = `500 20px ${ui}`;
  ctx.fillText("Signed by Vera", 64, sy + 32);
  drawSignature(ctx, 84, sy - 96, sig, theme.ink);

  // Verified on-chain: a status line under the tag, top right, that fades in
  // after the seal lands (the seal itself owns the bottom right).
  if (verified > 0) {
    ctx.save();
    ctx.globalAlpha = verified;
    ctx.textAlign = "right";
    ctx.font = `400 21px ${mono}`;
    ctx.fillStyle = theme.ink2;
    ctx.fillText("Verified on-chain", CW - 64, 130);
    ctx.fillStyle = theme.accent2;
    ctx.beginPath();
    ctx.arc(CW - 64 - ctx.measureText("Verified on-chain").width - 18, 123, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ----------------------------------------------------------------- scene --

interface Anim {
  sig: number;
  verified: number;
}

interface Doc {
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
}

function makeDoc(): Doc {
  const { canvas, ctx } = makeCanvas(CW, CH);
  return { ctx, tex: toTexture(canvas, 8) };
}

function redraw(doc: Doc, theme: Theme, a: Anim) {
  drawPlan(doc.ctx, theme, a.sig, a.verified);
  doc.tex.needsUpdate = true;
}

function Scene({ theme, reduced, fontReady }: SceneProps) {
  const root = useRef<Group>(null);
  const slab = useRef<Group>(null);
  const seal = useRef<Group>(null);
  const anim = useRef<Anim>({ sig: reduced ? 1 : 0, verified: reduced ? 1 : 0 });
  const drawn = useRef<Anim>({ sig: -1, verified: -1 });
  const dark = theme.mode === "dark";

  const doc = useMemo<Doc>(() => makeDoc(), []);
  useEffect(() => () => doc.tex.dispose(), [doc]);

  // Redraw when the theme or the fonts change.
  useEffect(() => {
    drawn.current.sig = -1;
  }, [theme, fontReady]);

  // The loop: sign, seal, verify, hold, restart.
  useEffect(() => {
    const s = seal.current;
    const sl = slab.current;
    if (reduced || !s || !sl) return;
    const a = anim.current;
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0 });
    tl.set(a, { sig: 0, verified: 0 }, 0);
    tl.set(s.position, { y: SEAL_Y + SEAL_DROP }, 0);
    tl.set(s.scale, { x: 1, y: 1, z: 1 }, 0);
    tl.to(a, { sig: 1, duration: 1.6, ease: "power1.inOut" }, 0.5);
    tl.to(s.position, { y: SEAL_Y, duration: 0.5, ease: "power2.in" }, 2.3);
    tl.to(s.scale, { x: 1.12, y: 1.12, z: 0.7, duration: 0.08, ease: "power1.out" }, 2.8);
    tl.to(s.scale, { x: 1, y: 1, z: 1, duration: 0.25, ease: "back.out(2)" }, 2.88);
    tl.to(sl.position, { y: -0.03, duration: 0.1, ease: "power2.out" }, 2.8);
    tl.to(sl.position, { y: 0, duration: 0.4, ease: "power2.out" }, 2.9);
    tl.to(a, { verified: 1, duration: 0.6, ease: "power1.out" }, 3.3);
    tl.to({}, { duration: 5 }, 3.9);
    return () => {
      tl.kill();
    };
  }, [reduced]);

  useFrame((state) => {
    const a = anim.current;
    if (a.sig !== drawn.current.sig || a.verified !== drawn.current.verified) {
      redraw(doc, theme, a);
      drawn.current.sig = a.sig;
      drawn.current.verified = a.verified;
    }
    const g = root.current;
    if (!g || reduced) return;
    const t = state.clock.elapsedTime;
    g.position.y = Math.sin((t / 6) * Math.PI * 2) * 0.04;
    // No pointer tilt: the slab holds its pose (user direction, 2026-09-06).
  });

  // Wax: a deeper terracotta than the accent so it reads as a seal, not a
  // button; the emboss catches the light in the accent itself.
  const wax = dark ? "#bf6a3a" : "#c66c3d";
  const emboss = dark ? "#e8a878" : "#e6a06e";

  return (
    <>
      <Lights theme={theme} />
      <group ref={root} scale={0.92}>
        <group ref={slab} rotation={[LEAN, 0, 0]}>
          <RoundedBox args={[SLAB_W, SLAB_H, SLAB_T]} radius={0.04} smoothness={4}>
            <meshPhysicalMaterial
              color={dark ? "#2b3530" : "#f6f8f3"}
              transmission={dark ? 0.3 : 0.5}
              roughness={0.2}
              thickness={0.3}
              clearcoat={0.6}
              clearcoatRoughness={0.15}
              ior={1.4}
              envMapIntensity={dark ? 0.9 : 1}
            />
          </RoundedBox>
          {/* The plan, on the front face. */}
          <mesh position={[0, 0, SLAB_T / 2 + 0.003]}>
            <planeGeometry args={[DOC_W, DOC_H]} />
            <meshBasicMaterial map={doc.tex} transparent toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
          </mesh>
          {/* The wax seal: a disc with an embossed ring and check. */}
          <group ref={seal} position={[SEAL_X, reduced ? SEAL_Y : SEAL_Y + SEAL_DROP, SEAL_Z]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.22, 0.235, 0.06, 64]} />
              <meshStandardMaterial color={wax} roughness={0.6} metalness={0} />
            </mesh>
            <group position={[0, 0, 0.036]}>
              <mesh>
                <torusGeometry args={[0.15, 0.012, 12, 64]} />
                <meshStandardMaterial color={emboss} roughness={0.55} />
              </mesh>
              <mesh position={[-0.06, -0.04, 0]} rotation={[0, 0, MathUtils.degToRad(-45)]}>
                <boxGeometry args={[0.095, 0.026, 0.018]} />
                <meshStandardMaterial color={emboss} roughness={0.55} />
              </mesh>
              <mesh position={[0.03, 0, 0]} rotation={[0, 0, MathUtils.degToRad(49.4)]}>
                <boxGeometry args={[0.19, 0.026, 0.018]} />
                <meshStandardMaterial color={emboss} roughness={0.55} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </>
  );
}

export default function Seal() {
  return (
    <Stage camera={{ fov: 26, position: [0, 0.95, 5.4], lookAt: [0, -0.02, 0] }} shadow={{ y: -1.02, scale: 5.5, blur: 2.6, opacity: 0.36, far: 2.4 }}>
      {(p) => <Scene {...p} />}
    </Stage>
  );
}
