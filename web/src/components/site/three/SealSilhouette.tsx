// A CSS-only silhouette of the signed-plan slab: one leaned glass rectangle
// with a faint seal disc, no text. Rendered by the hero while the three chunk
// loads, and kept when WebGL is unavailable. No three import here on purpose.
import s from "./SealSilhouette.module.css";

export function SealSilhouette({ className }: { className?: string }) {
  return (
    <div className={className ? `${s.root} ${className}` : s.root} aria-hidden="true">
      <div className={s.shadow} />
      <div className={s.slab}>
        <span className={s.seal} />
      </div>
    </div>
  );
}
