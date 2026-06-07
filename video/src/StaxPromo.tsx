import React from "react";
import { AbsoluteFill, Audio, Series, Sequence, interpolate, staticFile } from "remotion";
import { type AudioData } from "@remotion/media-utils";
import { CUT, dur, DROP_FRAME } from "./timeline";
import { COLOR } from "./theme";
import { LightLeak } from "./kinetic";
import { Build } from "./scenes/Build";
import { Drop } from "./scenes/Drop";
import { Product } from "./scenes/Product";
import { Stats, End } from "./scenes/Outro";

const Vo: React.FC<{ from: number; src: string }> = ({ from, src }) => (
  <Sequence from={from}>
    <Audio src={staticFile(src)} volume={1} />
  </Sequence>
);
const Sfx: React.FC<{ from: number; src: string; volume?: number }> = ({ from, src, volume = 0.6 }) => (
  <Sequence from={from}>
    <Audio src={staticFile(src)} volume={volume} />
  </Sequence>
);

// VO windows (abs frames) for ducking the music bed under Vera.
const VO = [
  { from: CUT.build[0] + 24, src: "audio/vo-1.mp3", len: 86 },
  { from: CUT.drop[0] + 2, src: "audio/vo-2.mp3", len: 43 },
  { from: CUT.product[0] + 6, src: "audio/vo-3.mp3", len: 70 },
  { from: CUT.product[0] + 96, src: "audio/vo-4.mp3", len: 188 },
  { from: CUT.end[0] + 12, src: "audio/vo-5.mp3", len: 74 },
];

const musicVolume = (f: number) => {
  // base: quiet tense build, jump up on the drop, fade as the track resolves (~27s)
  const base = interpolate(f, [0, 18, DROP_FRAME - 14, DROP_FRAME, 800, 820], [0, 0.16, 0.16, 0.4, 0.4, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // duck under each VO line
  let duck = 1;
  for (const v of VO) {
    const d = interpolate(f, [v.from - 5, v.from, v.from + v.len, v.from + v.len + 12], [1, 0.42, 0.42, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    duck = Math.min(duck, d);
  }
  return base * duck;
};

export const StaxPromo: React.FC<{ musicData?: AudioData | null }> = ({ musicData = null }) => {
  const planPush = CUT.product[0] + 90;
  const successPush = CUT.product[0] + 200;
  return (
    <AbsoluteFill style={{ background: COLOR.paper }}>
      <Series>
        <Series.Sequence durationInFrames={dur("build")}><Build /></Series.Sequence>
        <Series.Sequence durationInFrames={dur("drop")}><Drop audioData={musicData} start={CUT.drop[0]} /></Series.Sequence>
        <Series.Sequence durationInFrames={dur("product")}><Product /></Series.Sequence>
        <Series.Sequence durationInFrames={dur("stats")}><Stats audioData={musicData} start={CUT.stats[0]} /></Series.Sequence>
        <Series.Sequence durationInFrames={dur("end")}><End /></Series.Sequence>
      </Series>

      {/* Light leaks on the softer joins (Build->Drop stays a clean hard cut). */}
      <LightLeak at={CUT.product[0] - 6} from="right" />
      <LightLeak at={CUT.stats[0] - 6} from="left" tint="rgba(127,212,171," />
      <LightLeak at={CUT.end[0] - 6} from="right" />

      {/* Music bed — ducks under Vera, jumps on the drop, resolves at the end. */}
      <Audio src={staticFile("audio/music.mp3")} volume={musicVolume} />

      {/* Vera voiceover */}
      {VO.map((v) => (
        <Vo key={v.src} from={v.from} src={v.src} />
      ))}

      {/* Sound design */}
      <Sfx from={DROP_FRAME - 211} src="audio/sfx-riser.mp3" volume={0.5} />
      <Sfx from={DROP_FRAME} src="audio/sfx-impact.mp3" volume={0.75} />
      <Sfx from={DROP_FRAME} src="audio/sfx-subdrop.mp3" volume={0.6} />
      <Sfx from={CUT.product[0]} src="audio/sfx-whoosh.mp3" volume={0.4} />
      <Sfx from={planPush} src="audio/sfx-whoosh.mp3" volume={0.34} />
      <Sfx from={successPush} src="audio/sfx-whoosh.mp3" volume={0.34} />
      <Sfx from={successPush + 4} src="audio/sfx-success.mp3" volume={0.5} />
      {/* taps */}
      <Sfx from={CUT.product[0] + 46} src="audio/sfx-tick.mp3" volume={0.32} />
      <Sfx from={CUT.product[0] + 80} src="audio/sfx-tick.mp3" volume={0.32} />
      <Sfx from={CUT.product[0] + 186} src="audio/sfx-tick.mp3" volume={0.32} />
      {/* plan chips */}
      {[112, 119, 126, 133].map((d, i) => (
        <Sfx key={"chip" + i} from={CUT.product[0] + d} src="audio/sfx-tick.mp3" volume={0.28} />
      ))}
      {/* stats whoosh + punch ticks */}
      <Sfx from={CUT.stats[0]} src="audio/sfx-whoosh.mp3" volume={0.4} />
      {[0, 24, 48, 72].map((d, i) => (
        <Sfx key={"punch" + i} from={CUT.stats[0] + d} src="audio/sfx-tick.mp3" volume={0.5} />
      ))}
      {/* end shimmer */}
      <Sfx from={CUT.end[0]} src="audio/sfx-whoosh.mp3" volume={0.3} />
      <Sfx from={CUT.end[0] + 6} src="audio/sfx-success.mp3" volume={0.32} />
    </AbsoluteFill>
  );
};
