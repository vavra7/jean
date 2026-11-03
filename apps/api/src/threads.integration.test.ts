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
import { registerThreadsRoutes } from "./routes/threads.js";
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
  registerThreadsRoutes(app);
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
  // Ownership FKs cascade: deleting non-admin users removes their threads + messages.
  await pool.query(`DELETE FROM users WHERE email <> $1`, [ADMIN_EMAIL]);
  await pool.query("DELETE FROM models");
});

afterAll(async () => {
  await pool.end();
});

describe("integration: threads and model snapshots", () => {
  it("creates a thread snapshotting the user's last chosen model (null when never chosen)", async () => {
    const { userId, token } = await createUser("never@example.com");
    const app = await buildApp();
    await app.ready();

    // Never chosen a model → snapshot is null.
    let res = await app.inject({
      method: "POST",
      url: "/api/threads",
      cookies: cookieOf(token),
      body: {},
    });
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.payload);
    expect(created.selectedProvider).toBeNull();
    expect(created.selectedExternalModelId).toBeNull();

    // Last chosen model is snapshotted.
    await pool.query(
      "UPDATE users SET last_model_provider = $1, last_model_external_id = $2 WHERE id = $3",
      ["ollama", "llama3", userId],
    );
    res = await app.inject({
      method: "POST",
      url: "/api/threads",
      cookies: cookieOf(token),
      body: {},
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).selectedProvider).toBe("ollama");
    expect(JSON.parse(res.payload).selectedExternalModelId).toBe("llama3");
  });

  it("switching a Thread's model updates its snapshot and the user's last chosen model, validating against the catalog", async () => {
    const { userId, token } = await createUser("switch@example.com");
    await pool.query(
      "INSERT INTO models (label, provider, external_model_id) VALUES ($1, $2, $3)",
      ["m", "ollama", "llama3"],
    );
    const app = await buildApp();
    await app.ready();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/threads",
      cookies: cookieOf(token),
      body: {},
    });
    expect(createRes.statusCode).toBe(201);
    const threadId = JSON.parse(createRes.payload).id;

    // Valid catalog choice updates the thread snapshot and the user's last model.
    const switchRes = await app.inject({
      method: "PATCH",
      url: `/api/threads/${threadId}/model`,
      cookies: cookieOf(token),
      body: { provider: "ollama", externalModelId: "llama3" },
    });
    expect(switchRes.statusCode).toBe(200);
    const switched = JSON.parse(switchRes.payload);
    expect(switched.selectedProvider).toBe("ollama");
    expect(switched.selectedExternalModelId).toBe("llama3");

    const userRes = await pool.query(
      "SELECT last_model_provider, last_model_external_id FROM users WHERE id = $1",
      [userId],
    );
    expect(userRes.rows[0].last_model_provider).toBe("ollama");
    expect(userRes.rows[0].last_model_external_id).toBe("llama3");

    // Model not in catalog → 400.
    const badRes = await app.inject({
      method: "PATCH",
      url: `/api/threads/${threadId}/model`,
      cookies: cookieOf(token),
      body: { provider: "ollama", externalModelId: "unknown" },
    });
    expect(badRes.statusCode).toBe(400);

    // Another user's thread → 404, never 403.
    const { token: otherToken } = await createUser("other@example.com");
    const getRes = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}`,
      cookies: cookieOf(otherToken),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("message history survives a Model delete", async () => {
    const { userId, token } = await createUser("survive@example.com");
    await pool.query(
      "INSERT INTO models (label, provider, external_model_id) VALUES ($1, $2, $3)",
      ["m", "ollama", "llama3"],
    );
    const app = await buildApp();
    await app.ready();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/threads",
      cookies: cookieOf(token),
      body: {},
    });
    expect(createRes.statusCode).toBe(201);
    const threadId = JSON.parse(createRes.payload).id;

    await pool.query(
      `INSERT INTO messages (thread_id, role, content, model)
       VALUES ($1, 'user', 'hi', NULL), ($1, 'assistant', 'yo', 'ollama/llama3')`,
      [threadId],
    );

    // Deleting the Model must not alter history.
    await pool.query(
      "DELETE FROM models WHERE provider = $1 AND external_model_id = $2",
      ["ollama", "llama3"],
    );

    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/messages?limit=50`,
      cookies: cookieOf(token),
    });
    expect(res.statusCode).toBe(200);
    const messages = JSON.parse(res.payload);
    expect(messages.length).toBe(2);
    expect(messages.map((m: { model: string | null }) => m.model)).toEqual([
      "ollama/llama3",
      null,
    ]);
  });

  it("deleting a user cascades their Threads and Messages", async () => {
    const { userId, token } = await createUser("cascade@example.com");
    const app = await buildApp();
    await app.ready();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/threads",
      cookies: cookieOf(token),
      body: {},
    });
    expect(createRes.statusCode).toBe(201);
    const threadId = JSON.parse(createRes.payload).id;
    await pool.query(
      "INSERT INTO messages (thread_id, role, content, model) VALUES ($1, 'user', 'hi', NULL)",
      [threadId],
    );

    await pool.query("DELETE FROM users WHERE id = $1", [userId]);

    const threads = await pool.query("SELECT * FROM threads WHERE user_id = $1", [userId]);
    expect(threads.rows).toHaveLength(0);
    const messages = await pool.query("SELECT * FROM messages WHERE thread_id = $1", [
      threadId,
    ]);
    expect(messages.rows).toHaveLength(0);
  });

  it("paginates messages upward 50 at a time with no duplicates and no gaps", async () => {
    const { userId, token } = await createUser("page@example.com");
    const app = await buildApp();
    await app.ready();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/threads",
      cookies: cookieOf(token),
      body: {},
    });
    expect(createRes.statusCode).toBe(201);
    const threadId = JSON.parse(createRes.payload).id;

    const base = Date.now();
    for (let i = 0; i < 60; i++) {
      await pool.query(
        "INSERT INTO messages (thread_id, role, content, created_at) VALUES ($1, 'user', $2, to_timestamp($3))",
        [threadId, `msg-${i}`, (base + i) / 1000],
      );
    }

    const page1Res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/messages?limit=50`,
      cookies: cookieOf(token),
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = JSON.parse(page1Res.payload);
    expect(page1.length).toBe(50);

    const page2Res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/messages?before=${page1[49].id}&limit=50`,
      cookies: cookieOf(token),
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = JSON.parse(page2Res.payload);
    expect(page2.length).toBe(10);

    const ids1 = new Set(page1.map((m: { id: string }) => m.id));
    const ids2 = new Set(page2.map((m: { id: string }) => m.id));
    for (const id of ids2) {
      expect(ids1.has(id)).toBe(false);
    }

    // Combined, all 60 messages appear exactly once in descending recency.
    const all = [...page1, ...page2].map((m: { id: string }) => m.id);
    expect(new Set(all).size).toBe(60);
    const allWithContent = await pool.query(
      "SELECT id FROM messages WHERE thread_id = $1 ORDER BY created_at DESC, id DESC",
      [threadId],
    );
    expect(all).toEqual(allWithContent.rows.map((r) => r.id));
  });
});
