import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure functions only — the gift money maths (see src/lib/gifts.test.ts).
// Deliberately NOT the React setup from Next's Vitest guide: no jsdom, no plugin-react, no
// testing-library. Nothing here renders a component, and a browser-shaped environment would
// be weight the suite never uses.
//
// The `@/…` alias is spelled out rather than read from tsconfig by a plugin: it is one line,
// it matches the single `paths` entry in tsconfig.json, and it keeps `vite` itself out of
// the dependency tree. If tsconfig ever grows a second alias, this needs the same entry.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/` },
      // `server-only` throws on import outside a React Server Component. It ships an empty
      // module for exactly this, reached in the app by the `react-server` export condition
      // (the repo's own scripts pass `tsx --conditions=react-server` for the same reason).
      // Pointing at the file directly keeps the condition out of global resolution, so no
      // other package silently switches build.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
      },
    ],
  },
});
