import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { registerScaffoldRoutes } from "./scaffold.js";
import { hashToken } from "../auth.js";

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

const adminUserId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const userUserId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function sessionRow(isAdmin: boolean) {
  return {
    id: isAdmin ? adminUserId : userUserId,
    email: isAdmin ? "admin@example.com" : "user@example.com",
    display_name: null,
    is_admin: isAdmin,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
}

beforeEach(() => {
  setValidEnv();
  vi.stubGlobal("fetch", originalFetch);
  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    const s = sql.replace(/\s+/g, " ");
    // session lookup (auth): the token is hashed before it reaches the DB.
    if (s.includes("token_hash")) {
      const isAdmin = params?.[0] === hashToken("admin-token");
      return Promise.resolve({ rows: [sessionRow(isAdmin)] });
    }
    // scaffold read
    if (s.includes("FROM app_settings WHERE id = 1")) {
      return Promise.resolve({
        rows: [{ scaffold: "You are Jean, {{display_name}}'s agent." }],
      });
    }
    // scaffold upsert
    if (s.includes("INSERT INTO app_settings") && s.includes("ON CONFLICT")) {
      return Promise.resolve({ rows: [{ scaffold: String(params?.[0]) }] });
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
  registerScaffoldRoutes(app);
  return app;
}

describe("GET /api/admin/scaffold", () => {
  it("returns the current scaffold to an admin", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/scaffold",
      cookies: { session: "admin-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      scaffold: "You are Jean, {{display_name}}'s agent.",
    });
    const call = lastCallFor("FROM app_settings WHERE id = 1");
    expect(call).toBeDefined();
  });

  it("returns 401 without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/admin/scaffold" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin", async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("token_hash")) {
        return Promise.resolve({ rows: [sessionRow(false)] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/scaffold",
      cookies: { session: "user-token" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PUT /api/admin/scaffold", () => {
  it("upserts the scaffold and returns it", async () => {
    const next = "You are Jean, {{display_name}}'s agent. Today is {{date}}.";
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/scaffold",
      cookies: { session: "admin-token" },
      body: { scaffold: next },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ scaffold: next });
    const call = lastCallFor("INSERT INTO app_settings");
    expect(call).toBeDefined();
    expect(call!.sql).toContain("ON CONFLICT");
    expect(call!.params).toEqual([next]);
  });

  it("returns 400 when scaffold is missing", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/scaffold",
      cookies: { session: "admin-token" },
      body: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/scaffold",
      body: { scaffold: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin", async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("token_hash")) {
        return Promise.resolve({ rows: [sessionRow(false)] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/scaffold",
      cookies: { session: "user-token" },
      body: { scaffold: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});
