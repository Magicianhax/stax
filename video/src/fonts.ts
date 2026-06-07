// Brand fonts, loaded for Remotion rendering via @remotion/google-fonts.
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadHanken } from "@remotion/google-fonts/HankenGrotesk";
import { loadFont as loadJetBrains } from "@remotion/google-fonts/JetBrainsMono";

export const fraunces = loadFraunces("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
}).fontFamily;

export const hanken = loadHanken("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
}).fontFamily;

export const jetbrains = loadJetBrains("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
}).fontFamily;
