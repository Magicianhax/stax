// Apply pending Drizzle migrations (web/drizzle/*.sql) before `next build`.
//
// Runs on Vercel PRODUCTION builds only (VERCEL_ENV=production) over the direct,
// non-pooled Neon URL — PgBouncer's transaction pooling breaks DDL + advisory
// locks. Preview builds and local builds skip with a note, so a branch can never
// mutate the production schema and a laptop without the secret still builds.
// Migrations are idempotent (drizzle tracks them in drizzle.__drizzle_migrations),
// so a redeploy is a no-op.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const env = process.env.VERCEL_ENV;
  const url = process.env.DATABASE_URL_UNPOOLED;
  const forced = process.env.MIGRATE_ON_BUILD === "1";
  if (env !== "production" && !forced) {
    console.log(`[migrate] skipped (VERCEL_ENV=${env ?? "local"}; set MIGRATE_ON_BUILD=1 to force)`);
    return;
  }
  if (!url) {
    console.error("[migrate] DATABASE_URL_UNPOOLED is not set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  const started = Date.now();
  await migrate(db, { migrationsFolder: "drizzle" });
  await pool.end();
  console.log(`[migrate] up to date (${Date.now() - started} ms)`);
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
