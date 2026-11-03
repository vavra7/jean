import { Pool } from "pg";

export let pool: Pool | null = null;

export function initPool(connectionString: string): Pool {
  pool = new Pool({ connectionString });
  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error("database pool is not initialized; call initPool first");
  }
  return pool;
}
