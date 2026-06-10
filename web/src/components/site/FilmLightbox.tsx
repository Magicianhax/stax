"use client";

// Fullscreen lightbox for the 30s Stax film. Opens user-initiated (so sound is
// allowed), closes on Esc / backdrop / the X. The mp4 lives in Supabase Storage
// (public CDN bucket), NOT the repo, and only downloads when the viewer opens
// this — the landing page itself never pays the 8.7MB. Rendered through a
// portal on <body> so position:fixed can never be hijacked by a transformed
// ancestor (the landing uses 3D transforms on the demo phones).
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FILM_URL =
  "https://vjihfnxndqxgddybpqzk.supabase.co/storage/v1/object/public/media/stax-promo.mp4";

export function FilmLightbox({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    // preventScroll: focusing the dialog must never scroll the page behind it
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="film-lb"
      role="dialog"
      aria-modal="true"
      aria-label="Stax film, 30 seconds"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button ref={closeRef} className="film-lb-x" onClick={onClose} aria-label="Close film">
        <X size={22} strokeWidth={2.2} />
      </button>
      <div className="film-lb-frame">
        <video
          className="film-lb-video"
          src={FILM_URL}
          poster="/brand/film-poster.jpg"
          controls
          autoPlay
          playsInline
        />
      </div>
    </div>,
    document.body
  );
}
