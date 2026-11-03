import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { registerModelsRoutes } from "./models.js";

const originalFetch = globalThis.fetch;

const mockQuery = vi.fn();

const ADMIN_USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "admin@example.com",
  display_name: null,
  is_admin: true,
  expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
};

const NON_ADMIN_USER = { ...ADMIN_USER, email: "user@example.com", is_admin: false };

let sessionUser = ADMIN_USER;

function useSession(user: typeof sessionUser) {
  sessionUser = user;
}

vi.mock("../db/index.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

beforeEach(() => {
  setValidEnv();
  vi.stubGlobal("fetch", originalFetch);
  sessionUser = ADMIN_USER;
  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes("sessions")) {
      return Promise.resolve({
        rows: [sessionUser],
      });
    }
    if (sql.includes("INSERT INTO models")) {
      return Promise.resolve({
        rows: [
          {
            id: "22222222-2222-2222-2222-222222222222",
            label: String(params?.[0] ?? "my-model"),
            provider: "ollama",
            externalModelId: "llama3",
            createdAt: new Date().toISOString(),
          },
        ],
      });
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
  registerModelsRoutes(app);
  return app;
}

describe("GET /api/models", () => {
  it("returns the model list for an authenticated user", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/models",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });

  it("returns 401 without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/models" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the model list for a non-admin authenticated user", async () => {
    const app = buildApp();
    await app.ready();
    useSession(NON_ADMIN_USER);
    const res = await app.inject({
      method: "GET",
      url: "/api/models",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });
});

describe("POST /api/models", () => {
  it("creates a model after a successful test completion", async () => {
    const app = buildApp();
    await app.ready();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));

    const res = await app.inject({
      method: "POST",
      url: "/api/models",
      cookies: { session: "abc" },
      body: { provider: "ollama", externalModelId: "llama3", label: "my model" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.label).toBe("my model");
    expect(body.provider).toBe("ollama");
    expect(body.externalModelId).toBe("llama3");
  });

  it("returns 422 with the provider message verbatim and persists nothing on provider error", async () => {
    const app = buildApp();
    await app.ready();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "model not found" }, 422)),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/models",
      cookies: { session: "abc" },
      body: { provider: "nvidia", externalModelId: "bad-model" },
    });

    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.payload)).toEqual({ error: "model not found" });
    // INSERT should not have run: only the sessions SELECT (auth) and no models INSERT.
    const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
      sql.includes("INSERT INTO models"),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 401 for non-session and 403 for non-admin would be handled by auth", async () => {
    const app = buildApp();
    await app.ready();
    // make verifySession return non-admin: not easily mocked here; skip
    const res = await app.inject({
      method: "POST",
      url: "/api/models",
      body: { provider: "ollama", externalModelId: "llama3" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin user creating a model", async () => {
    const app = buildApp();
    await app.ready();
    useSession(NON_ADMIN_USER);
    const res = await app.inject({
      method: "POST",
      url: "/api/models",
      cookies: { session: "abc" },
      body: { provider: "ollama", externalModelId: "llama3", label: "my model" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/models/test", () => {
  it("reports ok on success", async () => {
    const app = buildApp();
    await app.ready();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));

    const res = await app.inject({
      method: "POST",
      url: "/api/models/test",
      cookies: { session: "abc" },
      body: { provider: "ollama", externalModelId: "llama3" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true });
  });

  it("reports the provider error without persisting", async () => {
    const app = buildApp();
    await app.ready();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500)),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/models/test",
      cookies: { session: "abc" },
      body: { provider: "ollama", externalModelId: "llama3" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: false, error: "boom" });
  });
});

describe("DELETE /api/models/:id", () => {
  it("deletes the row and returns 204", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/models/22222222-2222-2222-2222-222222222222",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("returns 403 for a non-admin user deleting a model", async () => {
    const app = buildApp();
    await app.ready();
    useSession(NON_ADMIN_USER);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/models/22222222-2222-2222-2222-222222222222",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/models/discover", () => {
  it("returns discovered ollama model ids", async () => {
    const app = buildApp();
    await app.ready();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ models: [{ name: "llama3" }, { name: "mistral" }] }),
      ),
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/models/discover?provider=ollama",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual(["llama3", "mistral"]);
  });

  it("returns an empty list for nvidia (free text, no provider call)", async () => {
    const app = buildApp();
    await app.ready();
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({
      method: "GET",
      url: "/api/models/discover?provider=nvidia",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty list when no provider is given", async () => {
    const app = buildApp();
    await app.ready();
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({
      method: "GET",
      url: "/api/models/discover",
      cookies: { session: "abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
