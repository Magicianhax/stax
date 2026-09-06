"use client";

// Desktop-width shell for admin pages, in the app's design system.
//
//   .stax (theme wrapper, widened via admin.module.css)
//     ToastProvider
//       .scroll (the one scrolling column; sheets + toasts stay viewport-fixed)
//         .page (max-width 1100px)
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/design/Toast";
import { useTheme } from "@/hooks/useTheme";
import s from "./admin.module.css";

export function AdminShell({ children }: { children: ReactNode }) {
  const { colorMode } = useTheme();
  return (
    <div className={`stax ${s.shell}`} data-theme="soft" data-mode={colorMode}>
      <ToastProvider>{children}</ToastProvider>
    </div>
  );
}

/** The scrolling column inside the shell. Sheets render as siblings of this. */
export function AdminScroll({ children }: { children: ReactNode }) {
  return (
    <div className={s.scroll}>
      <div className={s.page}>{children}</div>
    </div>
  );
}
