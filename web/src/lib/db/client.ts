import "server-only";

// Postgres (Neon) connection — SERVER ONLY.
//
// node-postgres Pool over the POOLED Neon URL (DATABASE_URL, the `-pooler`
// host), attached to Vercel Fluid compute via attachDatabasePool so idle
// connections are released before the function instance is suspended. Small
// pool: PgBouncer in front of Neon multiplexes for us, and each Vercel instance
// only ever runs a handful of concurrent requests.
//
// Migrations never go through here — drizzle-kit uses DATABASE_URL_UNPOOLED
// (see drizzle.config.ts).
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (pooled Neon connection string).");
  return url;
}

/** TLS per the URL: off for a local Postgres / `sslmode=disable`, verified otherwise. */
function sslFor(url: string): false | { rejectUnauthorized: true } {
  const u = new URL(url);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (local || u.searchParams.get("sslmode") === "disable") return false;
  return { rejectUnauthorized: true };
}

const url = connectionString();

export const pool = new Pool({
  connectionString: url,
  ssl: sslFor(url),
  max: 5,
  idleTimeoutMillis: 10_000,
});
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });
export type Db = typeof db;
