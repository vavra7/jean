import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./index.js";

const migrationSql = readFileSync(
  join(fileURLToPath(import.meta.url), "..", "..", "..", "migrations", "0001_users.sql"),
  "utf8",
);

export async function migrate(): Promise<void> {
  const pool = getPool();
  await pool.query(migrationSql);
}
