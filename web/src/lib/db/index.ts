// `import { db, schema } from "@/lib/db"` — server only (client.ts imports "server-only").
export { db, pool, type Db } from "./client";
export * as schema from "./schema";
export * from "./schema";
