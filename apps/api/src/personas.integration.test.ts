import { describe, expect, it, beforeAll, afterEach, afterAll } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { Pool } from "pg";
import { initPool, getPool } from "./db/index.js";
import { registerPersonaRoutes } from "./routes/persona.js";
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
  return crypto.createHmac("sha256", process.env.SESSION_SECRET!).update(token).digest("hex");
}

async function buildApp() {
  const app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.register(fastifyCookie);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerPersonaRoutes(app);
  return app;
}

async function createUser(email: string): Promise<{ userId: string; token: string }> {
  setValidEnv();
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash, is_admin) VALUES ($1, $2, false) RETURNING id",
    [email, "x"],
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
});

afterAll(async () => {
  await pool.end();
});

describe("integration: personas", () => {
  it("saves and returns the caller's persona", async () => {
    const { userId, token } = await createUser("persona-a@example.com");
    const app = await buildApp();
    await app.ready();

    const putRes = await app.inject({
      method: "PUT",
      url: "/api/persona",
      cookies: cookieOf(token),
      body: { content: "I like tea." },
    });
    expect(putRes.statusCode).toBe(200);
    expect(JSON.parse(putRes.payload)).toEqual({ content: "I like tea." });

    const getRes = await app.inject({
      method: "GET",
      url: "/api/persona",
      cookies: cookieOf(token),
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.payload)).toEqual({ content: "I like tea." });

    // Persisted row belongs to this user.
    const { rows } = await pool.query("SELECT content FROM personas WHERE user_id = $1", [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("I like tea.");
  });

  it("returns empty content for a user without a persona", async () => {
    const { token } = await createUser("persona-b@example.com");
    const app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/persona",
      cookies: cookieOf(token),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ content: "" });
  });

  it("lets no user read another's Persona", async () => {
    const { userId: ownerId, token: ownerToken } = await createUser("persona-owner@example.com");
    const { token: otherToken } = await createUser("persona-other@example.com");
    const app = await buildApp();
    await app.ready();

    await app.inject({
      method: "PUT",
      url: "/api/persona",
      cookies: cookieOf(ownerToken),
      body: { content: "secret" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/persona",
      cookies: cookieOf(otherToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ content: "" });

    // The owner's row was never touched by the other user's request.
    const { rows } = await pool.query("SELECT content FROM personas WHERE user_id = $1", [ownerId]);
    expect(rows[0].content).toBe("secret");
  });

  it("401s without a session", async () => {
    const app = await buildApp();
    await app.ready();
    const getRes = await app.inject({ method: "GET", url: "/api/persona" });
    const putRes = await app.inject({ method: "PUT", url: "/api/persona", body: { content: "x" } });
    expect(getRes.statusCode).toBe(401);
    expect(putRes.statusCode).toBe(401);
  });

  it("cascades on user delete", async () => {
    const { userId, token } = await createUser("persona-cascade@example.com");
    const app = await buildApp();
    await app.ready();

    await app.inject({
      method: "PUT",
      url: "/api/persona",
      cookies: cookieOf(token),
      body: { content: "to be deleted" },
    });
    const before = await pool.query("SELECT * FROM personas WHERE user_id = $1", [userId]);
    expect(before.rows).toHaveLength(1);

    await pool.query("DELETE FROM users WHERE id = $1", [userId]);

    const after = await pool.query("SELECT * FROM personas WHERE user_id = $1", [userId]);
    expect(after.rows).toHaveLength(0);
  });
});
