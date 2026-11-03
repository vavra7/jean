import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { registerMessagesRoutes } from "./messages.js";

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
    // session lookup (auth)
    if (s.includes("token_hash")) {
      return Promise.resolve({
        rows: [
          {
            id: userId,
            email: "a@example.com",
            display_name: null,
            is_admin: true,
            expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
          },
        ],
      });
    }
    // thread ownership + snapshot
    if (s.includes("FROM threads WHERE id = $1")) {
      return Promise.resolve({
        rows: [
          {
            id: threadId,
            user_id: userId,
            selectedProvider: "ollama",
            selectedExternalModelId: "llama3",
          },
        ],
      });
    }
    // insert user message
    if (s.includes("INSERT INTO messages") && s.includes("'user'")) {
      return Promise.resolve({ rows: [{ id: "msg-user-1" }] });
    }
    // history
    if (s.includes("FROM messages WHERE thread_id") && s.includes("ORDER BY")) {
      return Promise.resolve({ rows: [] });
    }
    // app_settings scaffold
    if (s.includes("FROM app_settings")) {
      return Promise.resolve({ rows: [{ scaffold: "You are Jean." }] });
    }
    // personas
    if (s.includes("FROM personas")) {
      return Promise.resolve({ rows: [] });
    }
    // insert assistant message
    if (s.includes("INSERT INTO messages") && s.includes("'assistant'")) {
      return Promise.resolve({ rows: [{ id: "msg-assistant-1" }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
  vi.restoreAllMocks();
});

function sseBody(lines: string[]): Response {
  const body = lines.map((l) => `data: ${l}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function ndjsonBody(lines: string[]): Response {
  const body = lines.map((l) => `${l}\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

function buildApp() {
  const app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.register(fastifyCookie);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerMessagesRoutes(app);
  return app;
}

function parseSSE(payload: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  let currentEvent = "";
  let currentData = "";
  for (const line of payload.split("\n")) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice("event: ".length);
    } else if (line.startsWith("data: ")) {
      currentData += line.slice("data: ".length);
    } else if (line === "") {
      if (currentData) {
        events.push({ event: currentEvent, data: JSON.parse(currentData) });
        currentEvent = "";
        currentData = "";
      }
    }
  }
  return events;
}

describe("POST /api/threads/:id/messages (streaming)", () => {
  it("streams tokens and done, persists the assistant message with model string", async () => {
    const app = buildApp();
    await app.ready();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        ndjsonBody([
          JSON.stringify({ message: { content: "hel" } }),
          JSON.stringify({ message: { content: "lo" } }),
          JSON.stringify({ done: true }),
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${threadId}/messages`,
      cookies: { session: "abc" },
      body: { content: "hello" },
    });

    expect(res.statusCode).toBe(200);
    const events = parseSSE(res.payload);
    const tokens = events.filter((e) => e.event === "token").map((e) => e.data.delta);
    expect(tokens).toEqual(["hel", "lo"]);
    const done = events.find((e) => e.event === "done");
    expect(done).toMatchObject({ data: { messageId: "msg-assistant-1", interrupted: false } });
    // assistant message persisted with "<provider>/<external_model_id>"
    const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
      sql.includes("'assistant'"),
    );
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0][1][2]).toBe("ollama/llama3");
  });

  it("streams reasoning deltas live (never persisted) and then text", async () => {
    const app = buildApp();
    await app.ready();
    // nvidia snapshot for this thread
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("token_hash")) {
        return Promise.resolve({
          rows: [{ id: userId, email: "a@example.com", display_name: null, is_admin: true, expires_at: new Date().toISOString() }],
        });
      }
      if (s.includes("FROM threads WHERE id = $1")) {
        return Promise.resolve({
          rows: [{ id: threadId, user_id: userId, selectedProvider: "nvidia", selectedExternalModelId: "nemotron" }],
        });
      }
      if (s.includes("INSERT INTO messages") && s.includes("'user'")) {
        return Promise.resolve({ rows: [{ id: "msg-user-1" }] });
      }
      if (s.includes("FROM messages WHERE thread_id") && s.includes("ORDER BY")) {
        return Promise.resolve({ rows: [] });
      }
      if (s.includes("FROM app_settings")) {
        return Promise.resolve({ rows: [{ scaffold: "You are Jean." }] });
      }
      if (s.includes("FROM personas")) {
        return Promise.resolve({ rows: [] });
      }
      if (s.includes("INSERT INTO messages") && s.includes("'assistant'")) {
        return Promise.resolve({ rows: [{ id: "msg-assistant-1" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseBody([
          JSON.stringify({
            choices: [{ delta: { reasoning_content: "thinking" } }],
          }),
          JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
          JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        ]),
      ),
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${threadId}/messages`,
      cookies: { session: "abc" },
      body: { content: "x" },
    });

    const events = parseSSE(res.payload);
    const reasoning = events.find((e) => e.event === "reasoning");
    expect(reasoning).toMatchObject({ data: { delta: "thinking" } });
    const tokens = events.filter((e) => e.event === "token").map((e) => e.data.delta);
    expect(tokens).toEqual(["hi"]);
  });

  it("returns 400 NO_MODEL when the thread has no snapshot", async () => {
    const app = buildApp();
    await app.ready();
    mockQuery.mockImplementation((sql: string) => {
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("token_hash")) {
        return Promise.resolve({
          rows: [{ id: userId, email: "a@example.com", display_name: null, is_admin: true, expires_at: new Date().toISOString() }],
        });
      }
      if (s.includes("FROM threads WHERE id = $1")) {
        return Promise.resolve({
          rows: [{ id: threadId, user_id: userId, selectedProvider: null, selectedExternalModelId: null }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${threadId}/messages`,
      cookies: { session: "abc" },
      body: { content: "x" },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload)).toMatchObject({ code: "NO_MODEL" });
    // nothing persisted: no assistant insert
    const assistantInserts = mockQuery.mock.calls.filter(([sql]) =>
      sql.includes("'assistant'"),
    );
    expect(assistantInserts).toHaveLength(0);
  });

  it("emits a provider error verbatim", async () => {
    const app = buildApp();
    await app.ready();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "model overloaded" }), { status: 500 })),
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${threadId}/messages`,
      cookies: { session: "abc" },
      body: { content: "x" },
    });

    expect(res.statusCode).toBe(200);
    const events = parseSSE(res.payload);
    const error = events.find((e) => e.event === "error");
    expect(error).toBeDefined();
    expect(error!.data.message).toBe("model overloaded");
  });

  it("persists partial with interrupted=true when the stream ends without done", async () => {
    const app = buildApp();
    await app.ready();
    // Tokens arrive but the upstream never sends a done event (e.g. client stopped).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ndjsonBody([
          JSON.stringify({ message: { content: "hel" } }),
          JSON.stringify({ message: { content: "lo" } }),
        ]),
      ),
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${threadId}/messages`,
      cookies: { session: "abc" },
      body: { content: "x" },
    });

    expect(res.statusCode).toBe(200);
    const events = parseSSE(res.payload);
    const done = events.find((e) => e.event === "done");
    expect(done).toMatchObject({
      data: { messageId: "msg-assistant-1", interrupted: true },
    });
    const assistantInserts = mockQuery.mock.calls.filter(([sql]) =>
      sql.includes("'assistant'"),
    );
    expect(assistantInserts).toHaveLength(1);
    expect(assistantInserts[0][0]).toContain(", true)");
    expect(assistantInserts[0][1][1]).toBe("hello");
    expect(assistantInserts[0][1][2]).toBe("ollama/llama3");
  });

  it("persists partial then emits error when provider fails after partial text", async () => {
    const app = buildApp();
    await app.ready();
    const reader = {
      read: vi.fn(),
      releaseLock: vi.fn(),
    };
    reader.read
      .mockResolvedValueOnce({
        value: new TextEncoder().encode('{"message":{"content":"hel"}}\n'),
        done: false,
      })
      .mockRejectedValueOnce(new Error("upstream reset"));
    const fakeResponse = {
      ok: true,
      body: { getReader: () => reader },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${threadId}/messages`,
      cookies: { session: "abc" },
      body: { content: "x" },
    });

    expect(res.statusCode).toBe(200);
    const events = parseSSE(res.payload);
    const error = events.find((e) => e.event === "error");
    expect(error).toBeDefined();
    const assistantInserts = mockQuery.mock.calls.filter(([sql]) =>
      sql.includes("'assistant'"),
    );
    expect(assistantInserts).toHaveLength(1);
    expect(assistantInserts[0][0]).toContain(", true)");
    expect(assistantInserts[0][1][1]).toBe("hel");
    expect(assistantInserts[0][1][2]).toBe("ollama/llama3");
  });

  it("adds NVIDIA org hint on 404", async () => {
    const app = buildApp();
    await app.ready();
    mockQuery.mockImplementation((sql: string) => {
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("token_hash")) {
        return Promise.resolve({
          rows: [{ id: userId, email: "a@example.com", display_name: null, is_admin: true, expires_at: new Date().toISOString() }],
        });
      }
      if (s.includes("FROM threads WHERE id = $1")) {
        return Promise.resolve({
          rows: [{ id: threadId, user_id: userId, selectedProvider: "nvidia", selectedExternalModelId: "nemotron" }],
        });
      }
      if (s.includes("INSERT INTO messages") && s.includes("'user'")) {
        return Promise.resolve({ rows: [{ id: "msg-user-1" }] });
      }
      if (s.includes("FROM messages WHERE thread_id") && s.includes("ORDER BY")) {
        return Promise.resolve({ rows: [] });
      }
      if (s.includes("FROM app_settings")) {
        return Promise.resolve({ rows: [{ scaffold: "You are Jean." }] });
      }
      if (s.includes("FROM personas")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
      ),
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${threadId}/messages`,
      cookies: { session: "abc" },
      body: { content: "x" },
    });

    expect(res.statusCode).toBe(200);
    const events = parseSSE(res.payload);
    const error = events.find((e) => e.event === "error");
    expect(error).toBeDefined();
    expect(error!.data.message).toBe("not found");
    expect(error!.data.hint).toBe("model not enabled for this NVIDIA org");
  });
});
