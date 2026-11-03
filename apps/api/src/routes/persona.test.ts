import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { registerPersonaRoutes } from "./persona.js";

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

beforeEach(() => {
  setValidEnv();
  vi.stubGlobal("fetch", originalFetch);
  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    const s = sql.replace(/\s+/g, " ");
    // session lookup (auth)
    if (s.includes("token_hash")) {
      return Promise.resolve({
        rows: [
          {
            id: userId,
            email: "a@example.com",
            display_name: null,
            is_admin: false,
            expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
          },
        ],
      });
    }
    // personas read: scoped to the caller's user_id
    if (s.includes("FROM personas WHERE user_id = $1")) {
      if (params?.[0] !== userId) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [{ content: "I like tea." }] });
    }
    // personas upsert
    if (s.includes("INSERT INTO personas") && s.includes("ON CONFLICT")) {
      return Promise.resolve({ rows: [{ content: params?.[1] }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
  vi.restoreAllMocks();
});

function lastCallFor(sqlFragment: string): { sql: string; params: unknown[] } | null {
  const calls = mockQuery.mock.calls.filter(([sql]) =>
    sql.replace(/\s+/g, " ").includes(sqlFragment.replace(/\s+/g, " ")),
  );
  if (calls.length === 0) return null;
  const [sql, params] = calls[calls.length - 1];
  return { sql, params: params ?? [] };
}

function buildApp() {
  const app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.register(fastifyCookie);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerPersonaRoutes(app);
  return app;
}

describe("GET /api/persona", () => {
  it("returns empty content when the user has no persona", async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("token_hash")) {
        return Promise.resolve({
          rows: [
            {
              id: userId,
              email: "a@example.com",
              display_name: null,
              is_admin: false,
              expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
            },
          ],
        });
      }
      if (s.includes("FROM personas WHERE user_id = $1")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/persona",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ content: "" });
    const call = lastCallFor("FROM personas WHERE user_id = $1");
    expect(call).toMatchObject({ params: [userId] });
  });

  it("returns the caller's persona content", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/persona",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ content: "I like tea." });
  });

  it("returns 401 without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/persona" });
    expect(res.statusCode).toBe(401);
  });

  it("never runs a read scoped to another user's id", async () => {
    const app = buildApp();
    await app.ready();
    await app.inject({
      method: "GET",
      url: "/api/persona",
      cookies: { session: "abc" },
    });
    const call = lastCallFor("FROM personas WHERE user_id = $1");
    expect(call?.params[0]).toBe(userId);
  });
});

describe("PUT /api/persona", () => {
  it("creates or updates the caller's persona and returns it", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PUT",
      url: "/api/persona",
      cookies: { session: "abc" },
      body: { content: "I like coffee." },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ content: "I like coffee." });
    const call = lastCallFor("INSERT INTO personas");
    expect(call).toBeDefined();
    expect(call!.sql).toContain("ON CONFLICT");
    expect(call!.params).toEqual([userId, "I like coffee."]);
  });

  it("allows clearing the persona (empty content)", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PUT",
      url: "/api/persona",
      cookies: { session: "abc" },
      body: { content: "" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ content: "" });
  });

  it("returns 400 when content is missing", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PUT",
      url: "/api/persona",
      cookies: { session: "abc" },
      body: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PUT",
      url: "/api/persona",
      body: { content: "x" },
    });
    expect(res.statusCode).toBe(401);
  });
});
