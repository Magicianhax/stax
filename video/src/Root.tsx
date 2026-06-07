import React from "react";
import { Composition, staticFile } from "remotion";
import { getAudioData, type AudioData } from "@remotion/media-utils";
import { StaxPromo } from "./StaxPromo";
import { WIDTH, HEIGHT, FPS } from "./theme";
import { TOTAL_FRAMES } from "./timeline";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="StaxPromo"
      component={StaxPromo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ musicData: null as AudioData | null }}
      calculateMetadata={async ({ props }) => {
        // Pre-fetch the music waveform once so scenes can react to the beat.
        let musicData: AudioData | null = null;
        try {
          musicData = await getAudioData(staticFile("audio/music.mp3"));
        } catch {
          musicData = null;
        }
        return { props: { ...props, musicData } };
      }}
    />
  );
};
