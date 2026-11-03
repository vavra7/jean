import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./index.js";

const migrationsDir = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "migrations",
);

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => join(migrationsDir, file));
}

export async function migrate(): Promise<void> {
  const pool = getPool();
  for (const file of migrationFiles()) {
    const sql = readFileSync(file, "utf8");
    await pool.query(sql);
  }
}
