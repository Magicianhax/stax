// Generates all promo audio via the ElevenLabs REST API.
//   Vera voiceover (per beat) + build/drop music bed + designed SFX.
// Reads ELEVEN_LABS_API_KEY from D:/Tools/mantle/.env. Run: node scripts/gen-audio.mjs
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = "D:/Tools/mantle/.env";
const OUT = resolve(process.cwd(), "public/audio");
mkdirSync(OUT, { recursive: true });

function getKey() {
  const raw = readFileSync(ENV_PATH, "utf8");
  const m = raw.match(/^\s*ELEVEN_?LABS_API_KEY\s*=\s*(.+)\s*$/m);
  if (!m) throw new Error("ELEVEN_LABS_API_KEY not found in " + ENV_PATH);
  return m[1].trim().replace(/^["']|["']$/g, "");
}
const KEY = getKey();

// Vera voiceover voice. Jessica — playful, bright, warm, conversational.
// Swap: Laura FGY2WhTYpPnrIDTdsKH5 (sassy) · Lily pFZP5JQG7iQjIQuC4Bku (velvety British).
const VERA_VOICE = "cgSgspJ2msm6clMCkdW9";

async function save(name, res) {
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${name}: ${res.status} ${t.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(OUT, name), buf);
  console.log(`  ✓ ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
}

async function tts(name, text) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VERA_VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.3, use_speaker_boost: true },
      }),
    },
  );
  await save(name, res);
}

async function sfx(name, text, duration_seconds, prompt_influence = 0.55) {
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, duration_seconds, prompt_influence }),
  });
  await save(name, res);
}

async function music(name, prompt, ms) {
  const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, music_length_ms: ms }),
  });
  await save(name, res);
}

const VO = [
  ["vo-1.mp3", "Investing always felt like a club you weren't invited to."],
  ["vo-2.mp3", "Stax changes that."],
  ["vo-3.mp3", "Tell Vera what you want, in plain words."],
  ["vo-4.mp3", "She turns it into real shares of companies you know. You invest in one tap. Gas free, and signed on chain."],
  ["vo-5.mp3", "Stax. Invest in plain words."],
];

const MUSIC_PROMPT =
  "Bright, confident, modern electronic track for a premium tech product launch. " +
  "It starts minimal and atmospheric with rising tension for the first 9 seconds, " +
  "then a satisfying beat drop at 9 seconds into punchy drums, bright plucky synths and a driving bassline. " +
  "Energetic, uplifting, clean and premium, with momentum through to a strong finish. No vocals.";

const SFX = [
  ["sfx-riser.mp3", "rising tension synth riser swelling to a climax, cinematic, smooth build", 7, 0.6],
  ["sfx-impact.mp3", "huge cinematic bass boom impact with deep sub, punchy and clean", 2, 0.6],
  ["sfx-subdrop.mp3", "deep sub bass drop hit, short and powerful", 1.2, 0.6],
  ["sfx-whoosh.mp3", "fast punchy transition whoosh with a short bass tail", 0.9, 0.55],
  ["sfx-tick.mp3", "crisp snappy digital UI tick click, very short", 0.5, 0.5],
  ["sfx-success.mp3", "bright satisfying success confirmation chime, short and clean", 1.3, 0.55],
];

async function main() {
  console.log("Voiceover (Vera / Jessica):");
  for (const [name, text] of VO) {
    if (existsSync(resolve(OUT, name))) { console.log(`  · ${name} exists, skip`); continue; }
    await tts(name, text);
  }
  console.log("Music (build → drop):");
  if (!existsSync(resolve(OUT, "music.mp3"))) await music("music.mp3", MUSIC_PROMPT, 31000);
  else console.log("  · music.mp3 exists, skip");
  console.log("SFX:");
  for (const [name, text, dur, infl] of SFX) {
    if (existsSync(resolve(OUT, name))) { console.log(`  · ${name} exists, skip`); continue; }
    await sfx(name, text, dur, infl);
  }
  console.log("\nDone. Files in public/audio/");
}

main().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
