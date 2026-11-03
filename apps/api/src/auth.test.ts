import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import argon2 from "argon2";
import {
  checkOrigin,
  checkLoginRateLimit,
  issueSession,
  verifySession,
} from "./auth.js";
import { registerAuthRoutes } from "./auth.js";
import { getPool } from "./db/index.js";
import { AuthMeSchema } from "@jean/shared";

const originalFetch = globalThis.fetch;

interface FakeUser {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  is_admin: boolean;
}

interface FakePool {
  query: ReturnType<typeof vi.fn>;
  reset: () => void;
  seed: (user: FakeUser) => void;
  sessionRows: () => Array<{
    token_hash: string;
    user_id: string;
    expires_at: Date;
  }>;
}

vi.mock("./db/index.js", () => {
  const sessionRows: Array<{
    token_hash: string;
    user_id: string;
    expires_at: Date;
  }> = [];
  const usersById = new Map<string, FakeUser>();
  const usersByEmail = new Map<string, FakeUser>();

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const s = sql.replace(/\s+/g, " ");
    // sessions SELECT (verifySession)
    if (s.includes("token_hash") && s.includes("JOIN users")) {
      const row = sessionRows.find((r) => r.token_hash === params?.[0]);
      if (!row) return { rows: [] };
      const user = usersById.get(row.user_id);
      return {
        rows: [
          {
            id: row.user_id,
            email: user?.email ?? "admin@example.com",
            display_name: user?.display_name ?? null,
            is_admin: user?.is_admin ?? false,
            expires_at: row.expires_at,
          },
        ],
      };
    }
    // users SELECT by email (login)
    if (s.includes("FROM users WHERE email = $1")) {
      const user = usersByEmail.get(String(params?.[0]));
      return { rows: user ? [user] : [] };
    }
    // sessions INSERT (issueSession)
    if (s.includes("INSERT INTO sessions")) {
      sessionRows.push({
        token_hash: String(params?.[1]),
        user_id: String(params?.[0]),
        expires_at: new Date(String(params?.[2])),
      });
      return { rows: [] };
    }
    // sessions DELETE (expired cleanup / logout)
    if (s.includes("DELETE FROM sessions WHERE token_hash = $1")) {
      const idx = sessionRows.findIndex(
        (r) => r.token_hash === String(params?.[0]),
      );
      if (idx !== -1) sessionRows.splice(idx, 1);
      return { rowCount: 1 };
    }
    // sessions UPDATE (sliding expiry)
    if (s.includes("UPDATE sessions SET expires_at")) {
      const row = sessionRows.find(
        (r) => r.token_hash === String(params?.[1]),
      );
      if (row) row.expires_at = new Date(String(params?.[0]));
      return { rowCount: 1 };
    }
    return { rows: [] };
  });

  const fakePool: FakePool = {
    query,
    reset() {
      sessionRows.length = 0;
      usersById.clear();
      usersByEmail.clear();
    },
    seed(user) {
      usersById.set(user.id, user);
      usersByEmail.set(user.email, user);
    },
    sessionRows: () => sessionRows,
  };

  return {
    getPool: () => fakePool,
  };
});

function setValidEnv() {
  process.env.DATABASE_URL = "postgres://jean:jean@127.0.0.1:5432/jean";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "password-must-be-at-least-eight";
  process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.NVIDIA_API_KEY = "nvapi-test-key";
  process.env.PUBLIC_ORIGIN = "http://localhost:5173";
  process.env.PORT = "3000";
}

const userId = "11111111-1111-1111-1111-111111111111";
const mockGetPool = getPool as unknown as () => FakePool;

beforeEach(async () => {
  setValidEnv();
  vi.stubGlobal("fetch", originalFetch);
  const pool = mockGetPool();
  pool.reset();
  // Real argon2id hash of the seeded Admin password, so login tests exercise
  // real hashing/verification against the seeded Admin credentials.
  const passwordHash = await argon2.hash(process.env.ADMIN_PASSWORD!, {
    type: argon2.argon2id,
  });
  pool.seed({
    id: userId,
    email: process.env.ADMIN_EMAIL!,
    password_hash: passwordHash,
    display_name: "Admin",
    is_admin: true,
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
  registerAuthRoutes(app);
  return app;
}

function setCookieHeader(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers["set-cookie"];
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.filter((c): c is string => typeof c === "string");
}

describe("checkOrigin", () => {
  it("allows same-origin and no-origin requests", () => {
    expect(checkOrigin("http://localhost:5173")).toBe(true);
    expect(checkOrigin(undefined)).toBe(true);
  });

  it("rejects a foreign Origin", () => {
    expect(checkOrigin("http://evil.example.com")).toBe(false);
  });
});

describe("checkLoginRateLimit", () => {
  it("allows 5 attempts then returns 429 with retryAfter", () => {
    const key = "1.2.3.4:user@example.com";
    for (let i = 0; i < 5; i++) {
      expect(checkLoginRateLimit(key).allowed).toBe(true);
    }
    const limited = checkLoginRateLimit(key);
    expect(limited.allowed).toBe(false);
    expect(limited.retryAfter).toBeGreaterThan(0);
  });

  it("tracks keys independently per IP+email", () => {
    expect(checkLoginRateLimit("a:x").allowed).toBe(true);
    expect(checkLoginRateLimit("b:x").allowed).toBe(true);
  });
});

describe("POST /api/auth/login", () => {
  it("returns identical 401 for unknown email", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      body: { email: "nope@example.com", password: "whatever" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload)).toEqual({ error: "invalid credentials" });
  });

  it("returns identical 401 for wrong password", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      body: { email: process.env.ADMIN_EMAIL!, password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload)).toEqual({ error: "invalid credentials" });
  });

  it("rejects mutations carrying a foreign Origin", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://evil.example.com" },
      body: { email: process.env.ADMIN_EMAIL!, password: process.env.ADMIN_PASSWORD! },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rate limits after 5 attempts per 15 min per IP+email with 429", async () => {
    const app = buildApp();
    await app.ready();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        body: { email: "ratelimit@example.com", password: "x" },
      });
      expect(res.statusCode).toBe(401);
    }
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      body: { email: "ratelimit@example.com", password: "x" },
    });
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.payload).error).toBe("too many attempts");
  });

  it("logs in with the seeded Admin credentials, sets httpOnly SameSite=Lax cookie, and /auth/me returns user", async () => {
    const app = buildApp();
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      body: {
        email: process.env.ADMIN_EMAIL!,
        password: process.env.ADMIN_PASSWORD!,
      },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = setCookieHeader(login);
    expect(setCookie.some((c) => c.includes("session="))).toBe(true);
    expect(setCookie.some((c) => c.includes("HttpOnly"))).toBe(true);
    expect(setCookie.some((c) => c.includes("SameSite=Lax"))).toBe(true);

    const cookie = setCookie
      .find((c) => c.startsWith("session="))
      ?.split(";")[0]
      ?.split("=")[1];

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { session: cookie ?? "" },
    });
    expect(me.statusCode).toBe(200);
    const body = AuthMeSchema.parse(JSON.parse(me.payload));
    expect(body.id).toBe(userId);
    expect(body.email).toBe(process.env.ADMIN_EMAIL);
    expect(body.displayName).toBe("Admin");
    expect(body.isAdmin).toBe(true);
  });

  it("returns 401 on /auth/me without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });
});

describe("issueSession / verifySession", () => {
  it("issues a session and verifies it with sliding expiry", async () => {
    const { token, expiresAt } = await issueSession(userId);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    expect(expiresAt instanceof Date).toBe(true);

    const user = await verifySession(token);
    expect(user).toMatchObject({
      id: userId,
      email: process.env.ADMIN_EMAIL,
      displayName: "Admin",
      isAdmin: true,
    });
  });

  it("returns null for an expired session and deletes it", async () => {
    const { token } = await issueSession(userId);
    const rows = mockGetPool().sessionRows();
    rows[rows.length - 1].expires_at = new Date(0);
    const user = await verifySession(token);
    expect(user).toBeNull();
    expect(mockGetPool().sessionRows().length).toBe(0);
  });

  it("returns null for an unknown token", async () => {
    const user = await verifySession("deadbeef");
    expect(user).toBeNull();
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie and invalidates the session", async () => {
    const app = buildApp();
    await app.ready();
    const { token } = await issueSession(userId);
    expect(mockGetPool().sessionRows().length).toBeGreaterThan(0);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { session: token },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = setCookieHeader(res);
    expect(
      setCookie.some((c) => c.startsWith("session=") && c.includes("Max-Age=0")),
    ).toBe(true);
    expect(mockGetPool().sessionRows().length).toBe(0);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { session: token },
    });
    expect(me.statusCode).toBe(401);
  });
});
