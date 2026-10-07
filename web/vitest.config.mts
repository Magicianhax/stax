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
    // Several route tests `await import("./route")` inside the test, which loads the route's whole
    // module graph. With dozens of files transforming in parallel (and again inside Vercel's build)
    // that first import can pass 5 s on a busy machine and fail a test that has nothing wrong.
    testTimeout: 20_000,
    // Tests must never reach real services. Vercel runs this suite inside `npm run build` with the
    // project's env loaded, so without this a test would read and write the shared production
    // Redis (and see keys left by an earlier build). Blank values make every module take its
    // documented in-memory / not-configured path, exactly as locally and in CI.
    env: {
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      WEB3_API_KEY: "",
      WEB3_SECRET_KEY: "",
    },
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
