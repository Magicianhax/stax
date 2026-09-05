// TEMPORARY preview route for the story sections — delete before handing off.
"use client";

import { useState } from "react";
import { HowItWorks } from "@/components/site/sections/HowItWorks";
import { Guarantee } from "@/components/site/sections/Guarantee";
import { Baskets } from "@/components/site/sections/Baskets";
import { Assets } from "@/components/site/sections/Assets";

export default function StoryPreview() {
  const [mode, setMode] = useState<"light" | "dark">("light");
  return (
    <div className="site" data-mode={mode} data-ready="">
      <div className="site-bg-mesh" />
      <div style={{ position: "relative", zIndex: 1 }}>
        <button type="button" onClick={() => setMode(mode === "light" ? "dark" : "light")} style={{ position: "fixed", top: 12, right: 12, zIndex: 9, height: 44, padding: "0 16px", borderRadius: 99 }}>
          {mode}
        </button>
        <HowItWorks />
        <Guarantee />
        <Baskets />
        <Assets />
      </div>
    </div>
  );
}
