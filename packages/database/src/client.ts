import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

export function createDatabase(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return drizzle(pool);
}
