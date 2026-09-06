"use client";

// Shared stage for the four hero prototypes: transparent canvas, dpr [1, 1.75],
// a neutral RoomEnvironment generated on the GPU, theme-following clear color
// and environment intensity, pointer tracking for tilt (hover devices only),
// reduced-motion → static pose on demand, and the loop paused off-screen.
// Each variant renders its scene through the `children` render prop.
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, type RootState } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei/core/ContactShadows";
import { Color, MathUtils, PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ensureFonts } from "./labels";
import { useSiteTheme, type Theme } from "./theme";
import s from "./stage.module.css";

export interface Pointer {
  x: number;
  y: number;
}

export interface SceneProps {
  theme: Theme;
  reduced: boolean;
  fontReady: boolean;
  pointer: RefObject<Pointer>;
}

export interface StageProps {
  camera: { fov: number; position: [number, number, number]; lookAt?: [number, number, number] };
  /** Ground shadow under the object; omit for none. */
  shadow?: { y: number; opacity?: number; scale?: number; blur?: number; far?: number };
  children: (p: SceneProps) => ReactNode;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const HOVER = "(hover: hover) and (prefers-reduced-motion: no-preference)";

function applyTheme(state: RootState, theme: Theme) {
  state.gl.setClearColor(new Color(theme.paper), 0);
  state.scene.environmentIntensity = theme.mode === "dark" ? 0.28 : 0.85;
}

/** Damped pointer tilt; call from useFrame. `max` in radians. */
export function dampTilt(tilt: { x: number; y: number }, p: Pointer, max: number, dt: number, lambda = 3.2) {
  tilt.x = MathUtils.damp(tilt.x, p.y * max, lambda, dt);
  tilt.y = MathUtils.damp(tilt.y, p.x * max, lambda, dt);
}

/** Soft sage key from the upper left, a terracotta rim from behind right. */
export function Lights({ theme, scale = 1 }: { theme: Theme; scale?: number }) {
  const dark = theme.mode === "dark";
  return (
    <>
      <ambientLight intensity={(dark ? 0.22 : 0.6) * scale} color={dark ? "#c9d8cc" : "#e8f1ea"} />
      <directionalLight position={[-3.2, 5, 4]} intensity={(dark ? 1.1 : 2.4) * scale} color="#d6ecdd" />
      <directionalLight position={[4, 2.6, -3.2]} intensity={(dark ? 1.0 : 1.7) * scale} color="#e3a06f" />
    </>
  );
}

export function Stage({ camera, shadow, children }: StageProps) {
  const theme = useSiteTheme();
  const wrap = useRef<HTMLDivElement>(null);
  const pointer = useRef<Pointer>({ x: 0, y: 0 });
  const root = useRef<RootState | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [fontReady, setFontReady] = useState(false);
  const [caps] = useState(() => ({ webgl: hasWebGL(), reduced: matchMedia(REDUCED).matches }));

  useEffect(() => {
    let alive = true;
    ensureFonts().then(() => alive && setFontReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

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

  const look = camera.lookAt ?? [0, 0, 0];
  const onCreated = useCallback(
    (state: RootState) => {
      root.current = state;
      const pmrem = new PMREMGenerator(state.gl);
      state.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      state.camera.lookAt(look[0], look[1], look[2]);
      applyTheme(state, theme);
      setReady(true);
    },
    // Creation-time theme and aim; later theme flips go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (root.current) applyTheme(root.current, theme);
  }, [theme]);

  const frameloop = caps.reduced ? "demand" : visible ? "always" : "never";
  const dark = theme.mode === "dark";

  return (
    <div ref={wrap} className={s.root} data-ready={ready ? "" : undefined}>
      {caps.webgl ? (
        <Canvas
          className={s.canvas}
          frameloop={frameloop}
          dpr={[1, 1.75]}
          camera={{ fov: camera.fov, position: camera.position, near: 0.1, far: 40 }}
          gl={{ alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: "high-performance", stencil: false }}
          onCreated={onCreated}
          resize={{ scroll: false }}
        >
          {children({ theme, reduced: caps.reduced, fontReady, pointer })}
          {shadow && (
            <ContactShadows
              position={[0, shadow.y, 0]}
              opacity={shadow.opacity ?? (dark ? 0.55 : 0.4)}
              blur={shadow.blur ?? 2.4}
              scale={shadow.scale ?? 5}
              far={shadow.far ?? 2.8}
              resolution={512}
              color={dark ? "#000000" : "#26342a"}
            />
          )}
        </Canvas>
      ) : (
        <div className={s.fallback}>WebGL unavailable</div>
      )}
    </div>
  );
}
