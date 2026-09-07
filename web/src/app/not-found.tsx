import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { SiteFrame } from "@/components/site/SiteFrame";
import { ShineButton } from "@/components/site/ui/ShineButton";
import s from "@/components/site/NotFound.module.css";
import { appUrl, siteUrl } from "@/lib/urls";

export const metadata: Metadata = {
  title: "Nothing here",
  description: "That page doesn't exist. Head back to Stax.",
  robots: { index: false, follow: false },
};

// Custom 404, on brand: the mark, the line, one primary button back to the
// site and a glass one into the app. Rendered inside the `.site` frame so the
// tokens, fonts and system theme match the rest of the marketing site.
export default function NotFound() {
  return (
    <SiteFrame>
      <main className={s.main}>
        <div className={s.box}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/stax-light.png" alt="Stax" width={56} height={56} className={s.mark} />
          <p className={s.code}>404</p>
          <h1 className={s.title}>Nothing here.</h1>
          <p className={s.line}>The page you were after has moved or never existed. The rest of Stax is where you left it.</p>
          <div className={s.ctas}>
            <ShineButton href={siteUrl("/")}>
              Back to Stax
              <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
            </ShineButton>
            <ShineButton href={appUrl()} variant="glass">
              Open the app
            </ShineButton>
          </div>
        </div>
      </main>
    </SiteFrame>
  );
}
