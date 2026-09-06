// A CSS-only silhouette of the tile stack: five glass slabs in perspective,
// no text. Rendered by the hero while the three chunk loads, and kept when
// WebGL is unavailable. No three import here on purpose: this ships in the
// main bundle.
import s from "./StackSilhouette.module.css";

const SLABS = [0, 1, 2, 3, 4];

export function StackSilhouette({ className }: { className?: string }) {
  return (
    <div className={className ? `${s.root} ${className}` : s.root} aria-hidden="true">
      <div className={s.shadow} />
      <div className={s.stage}>
        {SLABS.map((i) => (
          <div key={i} className={s.slab} style={{ "--i": i } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}
