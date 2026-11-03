import { describe, expect, it, beforeAll, afterEach, afterAll } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { Pool } from "pg";
import { initPool, getPool } from "../db/index.js";
import { registerAdminUsersRoutes } from "./admin-users.js";
import { registerAuthRoutes } from "../auth.js";
import * as crypto from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://jean:jean@127.0.0.1:5432/jean";
const ADMIN_EMAIL = "admin@example.com";

let pool: Pool;

function setValidEnv() {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = "password-must-be-at-least-eight";
  process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.NVIDIA_API_KEY = "nvapi-test-key";
  process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.PUBLIC_ORIGIN = "http://localhost:5173";
  process.env.PORT = "3000";
}

function hashToken(token: string): string {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET!)
    .update(token)
    .digest("hex");
}

async function buildApp() {
  const app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.register(fastifyCookie);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerAdminUsersRoutes(app);
  registerAuthRoutes(app);
  return app;
}

async function createUser(
  email: string,
  isAdmin = false,
): Promise<{ userId: string; token: string }> {
  setValidEnv();
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id",
    [email, "x", isAdmin],
  );
  const userId = rows[0].id;
  const token = "tok-" + email;
  await pool.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, hashToken(token), new Date(Date.now() + 1e10)],
  );
  return { userId, token };
}

function cookieOf(token: string) {
  return { session: token };
}

beforeAll(async () => {
  setValidEnv();
  initPool(DATABASE_URL);
  pool = getPool();
});

afterEach(async () => {
  await pool.query(`DELETE FROM users WHERE email <> $1`, [ADMIN_EMAIL]);
  await pool.query("DELETE FROM models");
});

afterAll(async () => {
  await pool.end();
});

describe("integration: admin users", () => {
  it("lists every account and lets an admin delete another user with full cascade", async () => {
    const { userId: adminId, token: adminToken } = await createUser(
      "admin-delete@example.com",
      true,
    );
    const { userId: victimId, token: victimToken } = await createUser(
      "victim@example.com",
      false,
    );

    // Victim data that must be cascaded.
    const { rows: threadRows } = await pool.query(
      "INSERT INTO threads (user_id, title) VALUES ($1, 'victim thread') RETURNING id",
      [victimId],
    );
    const threadId = threadRows[0].id;
    await pool.query(
      "INSERT INTO messages (thread_id, role, content) VALUES ($1, 'user', 'hi')",
      [threadId],
    );
    await pool.query(
      "INSERT INTO personas (user_id, content) VALUES ($1, 'victim persona')",
      [victimId],
    );
    // An invite created by the victim (unique token to avoid collisions across
    // runs, since the invites table is persisted and not truncated by other
    // suites' afterEach).
    const inviteEmail = `invite-${Date.now()}@example.com`;
    const inviteTok = `invite-tok-${Date.now()}`;
    await pool.query(
      `INSERT INTO invites (email, token_hash, expires_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [inviteEmail, hashToken(inviteTok), new Date(Date.now() + 1e10), victimId],
    );

    const app = await buildApp();
    await app.ready();

    // List shows both accounts.
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      cookies: cookieOf(adminToken),
    });
    expect(listRes.statusCode).toBe(200);
    const users = JSON.parse(listRes.payload);
    expect(users.map((u: { email: string }) => u.email)).toContain(
      "victim@example.com",
    );
    expect(users.map((u: { email: string }) => u.email)).toContain(
      "admin-delete@example.com",
    );

    // Non-admin cannot list.
    const forbiddenRes = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      cookies: cookieOf(victimToken),
    });
    expect(forbiddenRes.statusCode).toBe(403);

    // Admin cannot delete themselves.
    const selfRes = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${adminId}`,
      cookies: cookieOf(adminToken),
    });
    expect(selfRes.statusCode).toBe(403);

    // Delete the victim.
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${victimId}`,
      cookies: cookieOf(adminToken),
    });
    expect(delRes.statusCode).toBe(204);

    // User + cascaded rows are gone.
    expect(
      (await pool.query("SELECT * FROM users WHERE id = $1", [victimId])).rows,
    ).toHaveLength(0);
    expect(
      (await pool.query("SELECT * FROM threads WHERE user_id = $1", [victimId]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await pool.query("SELECT * FROM messages WHERE thread_id = $1", [threadId]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await pool.query("SELECT * FROM personas WHERE user_id = $1", [victimId]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await pool.query("SELECT * FROM sessions WHERE user_id = $1", [victimId]))
        .rows,
    ).toHaveLength(0);

    // Victim's invite remains listed as used, creator cleared.
    const invite = await pool.query(
      "SELECT used_at, created_by FROM invites WHERE email = $1",
      [inviteEmail],
    );
    expect(invite.rows).toHaveLength(1);
    expect(invite.rows[0].used_at).not.toBeNull();
    expect(invite.rows[0].created_by).toBeNull();

    // Victim's next request is unauthenticated (session cascaded).
    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: cookieOf(victimToken),
    });
    expect(meRes.statusCode).toBe(401);
  });
});
