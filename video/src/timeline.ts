// Hard-cut timeline, CONFORMED to the music: the real bass drop is at ~11.5s
// (measured via RMS scan of public/audio/music.mp3), and the track's natural
// sections (quiet intro 0-4s, build 4-11.5s, main 11.5-27s, resolve 27-30s)
// line up with build -> drop -> product/stats -> end. Absolute [start, end) frames @30fps.
export const TOTAL_FRAMES = 900; // 30s
export const DROP_FRAME = 344; // 11.47s — the musical drop

export const CUT = {
  build: [0, 344], // 0.0 - 11.5s  quiet intro -> rising tension / jargon storm
  drop: [344, 440], // 11.5 - 14.7s logo slam on the beat + "Stax changes that"
  product: [440, 725], // 14.7 - 24.2s persistent phone: goal -> plan -> invest
  stats: [725, 820], // 24.2 - 27.3s kinetic stat punches (music climax)
  end: [820, 900], // 27.3 - 30.0s end card (music resolves to quiet)
} as const;

export const dur = (k: keyof typeof CUT) => CUT[k][1] - CUT[k][0];
