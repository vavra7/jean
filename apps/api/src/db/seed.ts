import argon2 from "argon2";
import { getPool } from "./index.js";

export async function seedAdmin(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT count(*) AS count FROM users");
  if (Number(rows[0].count) > 0) {
    return;
  }

  const passwordHash = await argon2.hash(process.env.ADMIN_PASSWORD!, {
    type: argon2.argon2id,
  });

  await pool.query(
    "INSERT INTO users (email, password_hash, is_admin) VALUES ($1, $2, true)",
    [process.env.ADMIN_EMAIL, passwordHash],
  );
}
