import { DemoMount } from "@/components/demo/DemoMount";

// Auth-free, demo-data preview of the real Stax app — embedded by the marketing
// site phones and viewable directly at /demo. `?play=invest|vera` auto-plays a
// scripted walkthrough; no param = fully interactive. `?mode=dark` flips theme.
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ play?: string; mode?: string }>;
}) {
  const sp = await searchParams;
  const play = sp.play === "invest" || sp.play === "vera" ? sp.play : null;
  const mode = sp.mode === "light" ? "light" : "dark";
  return <DemoMount play={play} mode={mode} />;
}
