// drizzle-kit config. Migrations run over the DIRECT (non-pooled) Neon URL —
// PgBouncer's transaction pooling breaks DDL + advisory locks.
// The npm scripts load .env.local via `node --env-file` (no dotenv needed).
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set (direct Neon connection string).");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
