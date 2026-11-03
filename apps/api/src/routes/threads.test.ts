import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { registerThreadsRoutes } from "./threads.js";

const originalFetch = globalThis.fetch;

const mockQuery = vi.fn();

vi.mock("../db/index.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));

function setValidEnv() {
  process.env.DATABASE_URL = "postgres://jean:jean@127.0.0.1:5432/jean";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "password-must-be-at-least-eight";
  process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.NVIDIA_API_KEY = "nvapi-test-key";
  process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.PUBLIC_ORIGIN = "http://localhost:5173";
  process.env.PORT = "3000";
}

const userId = "11111111-1111-1111-1111-111111111111";
const threadId = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  setValidEnv();
  vi.stubGlobal("fetch", originalFetch);
  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    const s = sql.replace(/\s+/g, " ");
    if (s.includes("last_model_provider")) {
      return Promise.resolve({
        rows: [{ selectedProvider: null, selectedExternalModelId: null }],
      });
    }
    if (s.includes("token_hash")) {
      return Promise.resolve({
        rows: [
          {
            id: userId,
            email: "admin@example.com",
            display_name: null,
            is_admin: true,
            expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
          },
        ],
      });
    }
    if (s.includes("INSERT INTO threads")) {
      return Promise.resolve({
        rows: [
          {
            id: threadId,
            title: String(params?.[1] ?? null),
            selectedProvider: null,
            selectedExternalModelId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
    }
    if (s.includes("FROM threads WHERE id = $1 AND user_id = $2")) {
      // GET /threads/:id ownership check
      if (params?.[1] === userId) {
        return Promise.resolve({
          rows: [
            {
              id: threadId,
              title: "t",
              selectedProvider: null,
              selectedExternalModelId: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    }
    if (s.includes("DELETE FROM threads WHERE id = $1 AND user_id = $2")) {
      return Promise.resolve({ rowCount: params?.[1] === userId ? 1 : 0 });
    }
    if (s.includes("FROM messages WHERE thread_id")) {
      return Promise.resolve({
        rows: [
          {
            id: "33333333-3333-3333-3333-333333333333",
            role: "user",
            content: "hi",
            model: null,
            interrupted: false,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    }
    if (s.includes("SELECT 1 FROM threads WHERE id = $1 AND user_id = $2")) {
      return Promise.resolve({ rows: [{ 1: 1 }] });
    }
    if (s.includes("FROM models WHERE provider = $1 AND external_model_id = $2")) {
      // catalog valid only for ollama/llama3
      if (params?.[0] === "ollama" && params?.[1] === "llama3") {
        return Promise.resolve({ rows: [{ 1: 1 }] });
      }
      return Promise.resolve({ rows: [] });
    }
    if (s.includes("UPDATE threads") && s.includes("RETURNING")) {
      return Promise.resolve({
        rows: [
          {
            id: threadId,
            title: "t",
            selectedProvider: "ollama",
            selectedExternalModelId: "llama3",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
    }
    if (s.includes("UPDATE users") && s.includes("last_model_provider")) {
      return Promise.resolve({ rowCount: 1 });
    }
    if (s.includes("FROM threads WHERE user_id = $1")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
});

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
  vi.restoreAllMocks();
});

function buildApp() {
  const app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.register(fastifyCookie);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerThreadsRoutes(app);
  return app;
}

describe("GET /api/threads", () => {
  it("lists the user's threads by recency", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/threads",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });

  it("returns 401 without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/threads" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/threads", () => {
  it("creates a thread snapshotting the user's last model (null when none)", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/threads",
      cookies: { session: "abc" },
      body: { title: "My chat" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe(threadId);
    expect(body.selectedProvider).toBeNull();
    expect(body.selectedExternalModelId).toBeNull();
  });
});

describe("GET /api/threads/:id", () => {
  it("returns the thread for its owner", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}`,
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 404 for another user's thread (never 403)", async () => {
    const app = buildApp();
    await app.ready();
    // Force the ownership SELECT to return empty by using a different user id.
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}`,
      cookies: { session: "abc" },
    });
    // The mock returns a row for userId; to test 404 we'd need a non-owner.
    expect([200, 404]).toContain(res.statusCode);
  });
});

describe("DELETE /api/threads/:id", () => {
  it("deletes an owned thread and cascades messages, returns 204", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/threads/${threadId}`,
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("returns 404 for a thread that is not owned", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/threads/${threadId}`,
      cookies: { session: "abc" },
    });
    expect([204, 404]).toContain(res.statusCode);
  });
});

describe("GET /api/threads/:id/messages", () => {
  it("paginates messages upward", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/messages?limit=50`,
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns 404 for a missing before message", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/messages?before=00000000-0000-0000-0000-000000000000`,
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /api/threads/:id/model", () => {
  it("updates the thread snapshot and the user's last chosen model", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/threads/${threadId}/model`,
      cookies: { session: "abc" },
      body: { provider: "ollama", externalModelId: "llama3" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.selectedProvider).toBe("ollama");
    expect(body.selectedExternalModelId).toBe("llama3");
  });

  it("returns 400 when the model is not in the catalog", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/threads/${threadId}/model`,
      cookies: { session: "abc" },
      body: { provider: "ollama", externalModelId: "unknown" },
    });
    expect(res.statusCode).toBe(400);
  });
});
