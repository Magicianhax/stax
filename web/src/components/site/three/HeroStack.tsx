"use client";

// The hero object: a floating stack of seven glass share tiles, each carrying
// a real Base ticker. Loaded with next/dynamic (ssr: false) from Hero.tsx, so
// three/fiber/drei live in their own chunk. The CSS silhouette stays under
// the canvas until the first frame (and for good when WebGL is unavailable).
//
// Motion: the tiles drop in one by one on a spring, then the stack bobs
// (0.15 over 5s) and yaws (±6° over 12s); on hover devices it tilts toward
// the pointer, damped, at most 10°. Reduced motion renders one static pose on
// demand. The loop pauses while the hero is off-screen.
//
// Theme: read from `.site[data-mode]` at mount and on change; lights, tile
// tint, label ink and the clear color all follow it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei/core/ContactShadows";
import { Color, ExtrudeGeometry, MathUtils, PMREMGenerator, Shape, type Group, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { getChain } from "@/lib/chains";
import { displayFor } from "@/lib/displayAssets";
import { StackSilhouette } from "./StackSilhouette";
import { ensureLabelFont, makeTileLabel } from "./tileTexture";
import s from "./HeroStack.module.css";

// ---------------------------------------------------------------- content --

const BASE = getChain("base");
const WANTED = ["NVDA", "GOOGL", "AAPL", "META", "SPCX", "BTC", "ETH"];
// Only tickers the Base registry really lists, top of the stack first.
const TICKERS = WANTED.filter((t) => BASE.assets.all.some((a) => a.symbol === t));
const N = TICKERS.length;

// Tile: 1.6 wide (x), 1.0 deep (z), 0.06 thick (y); corners rounded 0.09.
const W = 1.6;
const D = 1.0;
const T = 0.06;
const RADIUS = 0.09;
const GAP = 0.12;
const STEP = T + GAP;
const LIFT = 0.1; // the top tile sits a little higher
const DROP = 2.6; // entrance start height above the resting pose
const MAX_TILT = MathUtils.degToRad(10);

// A fanned stack: each tile turned a few degrees around Y and Z and nudged so
// the edges read as separate sheets. Index 0 is the top tile.
const POSES = [
  { ry: 4, rz: 0, dx: 0, dz: 0 },
  { ry: -3, rz: 1.6, dx: 0.05, dz: -0.03 },
  { ry: 2.5, rz: -2.2, dx: -0.05, dz: 0.04 },
  { ry: -4, rz: 2.6, dx: 0.06, dz: 0.02 },
  { ry: 3, rz: -1.8, dx: -0.04, dz: -0.05 },
  { ry: -2.4, rz: 3, dx: 0.05, dz: 0.04 },
  { ry: 3.6, rz: -2.6, dx: -0.06, dz: -0.02 },
];

const restY = (i: number) => (N - 1 - i) * STEP - ((N - 1) * STEP) / 2 + (i === 0 ? LIFT : 0);
const BOTTOM_Y = restY(N - 1) - T / 2;

// Spring-ish settle for the drop: overshoots ~5% once, then rests.
function settle(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-6 * t) * Math.cos(4.6 * t);
}

// ------------------------------------------------------------------ theme --

type Mode = "light" | "dark";
interface Theme {
  mode: Mode;
  ink: string;
  ink2: string;
  line: string;
  paper: string;
}

function readTheme(): Theme {
  const el = document.querySelector<HTMLElement>(".site") ?? document.documentElement;
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const mode: Mode = el.getAttribute("data-mode") === "dark" ? "dark" : "light";
  return {
    mode,
    ink: get("--s-ink", mode === "dark" ? "#eef2ea" : "#232a24"),
    ink2: get("--s-ink-2", mode === "dark" ? "#a8b0a2" : "#545d52"),
    line: mode === "dark" ? "rgba(255,255,255,0.26)" : "rgba(40,52,38,0.26)",
    paper: get("--s-paper", mode === "dark" ? "#11150f" : "#eef1e8"),
  };
}

// Client-only (loaded with ssr: false), so the first render can read the DOM.
function useSiteTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const el = document.querySelector(".site");
    if (!el) return;
    const mo = new MutationObserver(() => setTheme(readTheme()));
    mo.observe(el, { attributes: true, attributeFilter: ["data-mode"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

// Low saturation: the brand color pulled most of the way toward the glass ground.
function tintFor(symbol: string, mode: Mode): Color {
  const c = new Color(displayFor(symbol).color);
  return mode === "dark" ? c.lerp(new Color("#6a746a"), 0.42) : c.lerp(new Color("#f7f9f2"), 0.4);
}

// --------------------------------------------------------------- geometry --

function makeTileGeometry(): ExtrudeGeometry {
  const shape = new Shape();
  const x = -W / 2;
  const y = -D / 2;
  const r = RADIUS;
  shape.moveTo(x + r, y);
  shape.lineTo(x + W - r, y);
  shape.quadraticCurveTo(x + W, y, x + W, y + r);
  shape.lineTo(x + W, y + D - r);
  shape.quadraticCurveTo(x + W, y + D, x + W - r, y + D);
  shape.lineTo(x + r, y + D);
  shape.quadraticCurveTo(x, y + D, x, y + D - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const bevel = 0.012;
  const geo = new ExtrudeGeometry(shape, {
    depth: T - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  // Lay it flat (face up) and centre it.
  geo.rotateX(-Math.PI / 2);
  geo.center();
  return geo;
}

// ------------------------------------------------------------------ scene --

interface SceneProps {
  theme: Theme;
  reduced: boolean;
  glass: boolean;
  fontReady: boolean;
  pointer: React.RefObject<{ x: number; y: number }>;
}

// Environment (a neutral room, generated on the GPU, nothing fetched), clear
// color and camera aim. Runs once from onCreated; the theme effect below
// re-applies the mode-dependent parts.
function setupRoot(state: RootState) {
  const pmrem = new PMREMGenerator(state.gl);
  state.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  state.camera.lookAt(LOOK_AT[0], LOOK_AT[1], LOOK_AT[2]);
}

function applyTheme(state: RootState, theme: Theme) {
  state.gl.setClearColor(new Color(theme.paper), 0);
  state.scene.environmentIntensity = theme.mode === "dark" ? 0.5 : 0.85;
}

// The camera sits on one ray from the look-at point; the distance shrinks on
// the wide 4:3 stage so the stack fills it the same way as the 1:1 one.
const CAM_DIR = [0, 0.57, 0.77] as const;
const LOOK_AT = [0, 0.28, 0] as const;
function CameraRig() {
  const last = useRef(0);
  useFrame(({ camera, viewport }) => {
    if (viewport.aspect === last.current) return;
    last.current = viewport.aspect;
    const dist = viewport.aspect > 1.15 ? 3.7 : 4.25;
    camera.position.set(CAM_DIR[0] * dist + LOOK_AT[0], CAM_DIR[1] * dist + LOOK_AT[1], CAM_DIR[2] * dist + LOOK_AT[2]);
    camera.lookAt(LOOK_AT[0], LOOK_AT[1], LOOK_AT[2]);
  });
  return null;
}

function Lights({ theme }: { theme: Theme }) {
  const dark = theme.mode === "dark";
  return (
    <>
      <ambientLight intensity={dark ? 0.4 : 0.6} color={dark ? "#c9d8cc" : "#e8f1ea"} />
      {/* Key: soft, sage-tinted, from the upper left front. */}
      <directionalLight position={[-3.2, 5, 4]} intensity={dark ? 2.2 : 2.4} color="#d6ecdd" />
      {/* Rim: terracotta, from behind on the right. */}
      <directionalLight position={[4, 2.6, -3.2]} intensity={dark ? 2.6 : 1.7} color="#e3a06f" />
    </>
  );
}

function Stack({ theme, reduced, glass, fontReady, pointer }: SceneProps) {
  const group = useRef<Group>(null);
  const tiles = useRef<(Group | null)[]>([]);
  const start = useRef<number | null>(null);
  const tilt = useRef({ x: 0, y: 0 });
  const maxAniso = useThree((st) => st.gl.capabilities.getMaxAnisotropy());

  const geometry = useMemo(() => makeTileGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const tints = useMemo(() => TICKERS.map((t) => tintFor(t, theme.mode)), [theme.mode]);

  // Labels are regenerated when the theme flips or the web font arrives.
  const labels = useMemo<Texture[]>(
    () =>
      TICKERS.map((t, i) =>
        makeTileLabel(
          t,
          displayFor(t).name,
          // Tiles under the top one read through the glass; their ink is
          // faint so they sit behind the top ticker instead of competing.
          i === 0 ? { ink: theme.ink, ink2: theme.ink2, line: theme.line } : { ink: theme.line, ink2: theme.line, line: theme.line },
          Math.min(8, maxAniso),
        ),
      ),
    // fontReady only forces a redraw once the font can be used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, maxAniso, fontReady],
  );
  useEffect(() => () => labels.forEach((l) => l.dispose()), [labels]);

  useFrame((state, rawDt) => {
    const g = group.current;
    if (!g || reduced) return;
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    if (start.current === null) start.current = t;
    const e = t - start.current;

    // Idle: bob and yaw.
    g.position.y = Math.sin((e / 5) * Math.PI * 2) * 0.15;
    const yaw = Math.sin((e / 12) * Math.PI * 2) * MathUtils.degToRad(6);

    // Pointer tilt, damped.
    const p = pointer.current;
    tilt.current.x = MathUtils.damp(tilt.current.x, p.y * MAX_TILT, 3.2, dt);
    tilt.current.y = MathUtils.damp(tilt.current.y, p.x * MAX_TILT, 3.2, dt);
    g.rotation.set(tilt.current.x, yaw + tilt.current.y, 0);

    // Entrance: bottom tile first, each on its own spring.
    for (let i = 0; i < N; i++) {
      const m = tiles.current[i];
      if (!m) continue;
      const local = (e - 0.1 - (N - 1 - i) * 0.11) / 0.95;
      m.position.y = restY(i) + (1 - settle(local)) * DROP;
    }
  });

  return (
    <group ref={group}>
      {TICKERS.map((ticker, i) => {
        const pose = POSES[i % POSES.length];
        const tint = tints[i];
        return (
          <group
            key={ticker}
            ref={(el) => {
              tiles.current[i] = el;
            }}
            position={[pose.dx, reduced ? restY(i) : restY(i) + DROP, pose.dz]}
            rotation={[0, MathUtils.degToRad(pose.ry), MathUtils.degToRad(pose.rz)]}
          >
            <mesh geometry={geometry}>
              {glass ? (
                <meshPhysicalMaterial
                  color={tint}
                  transmission={theme.mode === "dark" ? 0.5 : 0.42}
                  roughness={theme.mode === "dark" ? 0.3 : 0.42}
                  thickness={0.4}
                  clearcoat={0.6}
                  clearcoatRoughness={0.18}
                  ior={1.3}
                  attenuationColor={tint}
                  attenuationDistance={1.6}
                  envMapIntensity={1}
                />
              ) : (
                <meshStandardMaterial color={tint} roughness={0.32} metalness={0.04} transparent opacity={0.92} />
              )}
            </mesh>
            <mesh position={[0, T / 2 + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[W - 0.16, D - 0.16]} />
              <meshBasicMaterial
                map={labels[i]}
                alphaTest={0.5}
                alphaToCoverage
                toneMapped={false}
                polygonOffset
                polygonOffsetFactor={-2}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ------------------------------------------------------------------ mount --

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

// Glass (transmission) costs a scene pass per frame; keep it for capable
// pointer devices and give phones and small machines the standard material.
function wantsGlass(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = matchMedia("(pointer: coarse)").matches;
  const cores = nav.hardwareConcurrency ?? 8;
  const mem = nav.deviceMemory ?? 8;
  return !coarse && cores >= 4 && mem >= 4;
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const HOVER = "(hover: hover) and (prefers-reduced-motion: no-preference)";

export default function HeroStack() {
  const theme = useSiteTheme();
  const wrap = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [fontReady, setFontReady] = useState(false);
  const root = useRef<RootState | null>(null);
  const [caps] = useState(() => ({
    webgl: hasWebGL(),
    glass: wantsGlass(),
    reduced: matchMedia(REDUCED).matches,
  }));

  useEffect(() => {
    let alive = true;
    ensureLabelFont().then(() => alive && setFontReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Pause the loop while the hero is off-screen.
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Tilt toward the pointer on hover devices only; the target is relative to
  // the stage so the whole hero steers it, and it returns to rest on leave.
  useEffect(() => {
    if (!matchMedia(HOVER).matches) return;
    const el = wrap.current;
    if (!el) return;
    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = (ev.clientX - (r.left + r.width / 2)) / (r.width * 0.9);
      const ny = (ev.clientY - (r.top + r.height / 2)) / (r.height * 0.9);
      pointer.current.x = MathUtils.clamp(nx, -1, 1);
      pointer.current.y = MathUtils.clamp(ny, -1, 1);
    };
    const onLeave = () => {
      pointer.current.x = 0;
      pointer.current.y = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const onCreated = useCallback(
    (state: RootState) => {
      root.current = state;
      setupRoot(state);
      applyTheme(state, theme);
      setReady(true);
    },
    // The theme at creation time; later flips go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (root.current) applyTheme(root.current, theme);
  }, [theme]);

  const frameloop = caps.reduced ? "demand" : visible ? "always" : "never";

  return (
    <div ref={wrap} className={s.root} data-ready={ready ? "" : undefined}>
      <StackSilhouette className={s.ghost} />
      {caps.webgl && (
        <Canvas
          className={s.canvas}
          frameloop={frameloop}
          dpr={[1, 1.75]}
          camera={{ fov: 32, position: [0, 2.72, 3.3], near: 0.1, far: 30 }}
          gl={{ alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: "high-performance", stencil: false }}
          onCreated={onCreated}
          resize={{ scroll: false }}
        >
          <CameraRig />
          <Lights theme={theme} />
          <Stack theme={theme} reduced={caps.reduced} glass={caps.glass} fontReady={fontReady} pointer={pointer} />
          <ContactShadows
            position={[0, BOTTOM_Y - 0.06, 0]}
            opacity={theme.mode === "dark" ? 0.55 : 0.4}
            blur={2.4}
            scale={5}
            far={2.8}
            resolution={512}
            color={theme.mode === "dark" ? "#000000" : "#26342a"}
          />
        </Canvas>
      )}
    </div>
  );
}
