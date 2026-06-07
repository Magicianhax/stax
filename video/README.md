# Stax Promo Video (Remotion)

A 30s, 1920x1080 promo for Stax — "Invest in plain words." Calm & premium: warm paper,
sage glass, Fraunces display, real captured app screens in a phone, Vera voiceover + music.

## Structure

- `src/StaxPromo.tsx` — master composition (5 scenes via `<TransitionSeries>` + audio layer)
- `src/scenes/` — `Open`, `Problem`, `Demo`, `Proof`, `CTA`
- `src/components/` — `PhoneFrame`, `ui` (paper bg, glass, helpers), `Icons`
- `src/theme.ts` / `src/timeline.ts` / `src/fonts.ts` — brand tokens, durations, fonts
- `public/screens/` — real app screens captured from `www.stax.best/demo?mode=light`
- `public/audio/` — Vera voiceover (`vo-*.mp3`), `music.mp3`, `sfx-*.mp3`
- `scripts/gen-audio.mjs` — regenerates all audio via the ElevenLabs API

## Develop / render

```bash
npm install
npm run studio                 # preview at http://localhost:3000
npm run render                 # out/stax-promo.mp4 (crf 18, bt709)
npm run render:draft           # fast draft
```

## Regenerate audio

Voiceover = ElevenLabs "Sarah" (warm female). Reads `ELEVEN_LABS_API_KEY` from
`D:/Tools/mantle/.env`. Existing files are skipped — delete one to regenerate it.

```bash
node scripts/gen-audio.mjs
```

## Recapture app screens

Screens are captured at a 440x956 viewport from the live demo. To refresh them, screenshot
`https://www.stax.best/demo?mode=light` (home) and drive the Vera flow (goal → plan → success),
saving to `public/screens/`.

## Pinned versions

All Remotion packages are pinned to `4.0.429` (a fully-published, consistent set) via
`overrides` — do not bump piecemeal or the CLI/renderer can skew and crash.
