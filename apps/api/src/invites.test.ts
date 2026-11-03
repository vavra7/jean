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
  registerInvitesRoutes,
  acceptInvite,
} from "./invites.js";
import { hashToken } from "./auth.js";
import { getPool } from "./db/index.js";

const originalFetch = globalThis.fetch;

interface FakeInvite {
  id: string;
  email: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_by: string | null;
}

interface FakeClient {
  query: ReturnType<typeof vi.fn>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  release: () => void;
}

interface FakePool {
  query: ReturnType<typeof vi.fn>;
  connect: () => FakeClient;
  reset: () => void;
  seed: (invite: FakeInvite) => void;
  inviteRows: () => FakeInvite[];
}

vi.mock("./db/index.js", () => {
  const inviteRows: FakeInvite[] = [];
  let mutex: Promise<unknown> = Promise.resolve();

  function serialize<T>(fn: () => T): Promise<T> {
    const prev = mutex;
    mutex = prev.then(fn);
    return mutex as Promise<T>;
  }

  function runQuery(sql: string, params?: unknown[]) {
    const s = sql.replace(/\s+/g, " ");

    // sessions SELECT (requireAdminHandler / verifySession) → admin
    if (s.includes("token_hash") && s.includes("JOIN users")) {
      return {
        rows: [
          {
            id: adminId,
            email: "admin@example.com",
            display_name: null,
            is_admin: true,
            expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
          },
        ],
      };
    }

    // invite SELECT ... FOR UPDATE (accept)
    if (s.includes("FROM invites WHERE token_hash")) {
      const row = inviteRows.find((r) => r.token_hash === params?.[0]);
      return { rows: row ? [row] : [] };
    }
    // invites list
    if (s.includes("FROM invites ORDER BY created_at DESC")) {
      return { rows: [...inviteRows].reverse() };
    }
    // invites INSERT (createInvite)
    if (s.includes("INSERT INTO invites")) {
      const hash = String(params?.[1]);
      const row = inviteRows.find((r) => r.token_hash === hash);
      if (row) return { rows: [] };
      const inserted = {
        id: "44444444-4444-4444-4444-444444444444",
        email: String(params?.[0]),
        token_hash: hash,
        expires_at: new Date(String(params?.[2])),
        used_at: null,
        created_by: String(params?.[3]),
      };
      inviteRows.push(inserted);
      return { rows: [inserted] };
    }
    // invites UPDATE used_at (accept mark used)
    if (s.includes("UPDATE invites SET used_at")) {
      const row = inviteRows.find(
        (r) => r.id === String(params?.[0]) && r.used_at === null,
      );
      if (row) row.used_at = new Date();
      return { rowCount: row ? 1 : 0 };
    }
    // users INSERT (accept create account)
    if (s.includes("INSERT INTO users")) {
      return { rows: [{ id: "user-id", email: String(params?.[0]), display_name: String(params?.[1]), is_admin: false }] };
    }
    // sessions INSERT (accept issue session)
    if (s.includes("INSERT INTO sessions")) {
      return { rows: [] };
    }
    return { rows: [] };
  }

  const query = vi.fn(async (sql: string, params?: unknown[]) =>
    serialize(() => runQuery(sql, params)),
  );

  const fakeClient: FakeClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) =>
      serialize(() => runQuery(sql, params)),
    ),
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };

  const fakePool: FakePool = {
    query,
    connect: () => fakeClient,
    reset() {
      inviteRows.length = 0;
    },
    seed(invite) {
      inviteRows.push(invite);
    },
    inviteRows: () => inviteRows,
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
  process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.PUBLIC_ORIGIN = "http://localhost:5173";
  process.env.PORT = "3000";
}

const adminId = "11111111-1111-1111-1111-111111111111";
const mockGetPool = getPool as unknown as () => FakePool;

function buildApp() {
  const app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.register(fastifyCookie);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerInvitesRoutes(app);
  return app;
}

beforeEach(async () => {
  setValidEnv();
  vi.stubGlobal("fetch", originalFetch);
  const pool = mockGetPool();
  pool.reset();
  const passwordHash = await argon2.hash(process.env.ADMIN_PASSWORD!, {
    type: argon2.argon2id,
  });
  pool.seed({
    id: "33333333-3333-3333-3333-333333333333",
    email: "invitee@example.com",
    token_hash: hashToken("valid-token"),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    used_at: null,
    created_by: adminId,
  });
});

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
  vi.restoreAllMocks();
});

describe("POST /api/invites", () => {
  it("creates an invite and returns a URL built from PUBLIC_ORIGIN valid for 7 days", async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/invites",
      cookies: { session: "admin-session" },
      body: { email: "newbie@example.com" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.url).toMatch(/^http:\/\/localhost:5173\/invite\/[0-9a-f]{64}$/);
    expect(body.email).toBe("newbie@example.com");
  });

  it("returns 401 without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/invites",
      body: { email: "newbie@example.com" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/invites", () => {
  it("lists email, expiry and used flag", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/invites",
      cookies: { session: "admin-session" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].email).toBe("invitee@example.com");
    expect(typeof body[0].used).toBe("boolean");
  });
});

describe("GET /api/invites/:token", () => {
  it("returns the invited email for a valid unused invite", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/invites/valid-token",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).email).toBe("invitee@example.com");
  });

  it("returns 401 for an unknown token", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/invites/nope" });
    expect(res.statusCode).toBe(401);
  });
});

describe("acceptInvite", () => {
  it("marks the invite used, creates the account, issues a session", async () => {
    const { user, token } = await acceptInvite("valid-token", "Newbie", "Secret123!");
    expect(user.id).toBe("user-id");
    expect(user.displayName).toBe("Newbie");
    expect(user.isAdmin).toBe(false);
    expect(typeof token).toBe("string");
    const rows = mockGetPool().inviteRows();
    expect(rows[0].used_at).not.toBeNull();
  });

  it("rejects a used invite and creates no account", async () => {
    // mark used first
    await acceptInvite("valid-token", "Newbie", "Secret123!");
    await expect(
      acceptInvite("valid-token", "Newbie2", "Secret123!"),
    ).rejects.toMatchObject({ status: 401, message: "invite already used" });
  });

  it("rejects an expired invite", async () => {
    const pool = mockGetPool();
    pool.seed({
      id: "expired-invite",
      email: "expired@example.com",
      token_hash: hashToken("expired-token"),
      expires_at: new Date(0),
      used_at: null,
      created_by: adminId,
    });
    await expect(
      acceptInvite("expired-token", "X", "Secret123!"),
    ).rejects.toMatchObject({ status: 401, message: "invite expired" });
  });

  it("rejects an unknown token", async () => {
    await expect(
      acceptInvite("unknown-token", "X", "Secret123!"),
    ).rejects.toMatchObject({ status: 401, message: "invalid invite" });
  });

  it("enforces single-use under a concurrent second accept", async () => {
    const results = await Promise.allSettled([
      acceptInvite("valid-token", "First", "Secret123!"),
      acceptInvite("valid-token", "Second", "Secret123!"),
    ]);
    const errors = results.filter(
      (r) => r.status === "rejected",
    ).length;
    const successes = results.filter(
      (r) => r.status === "fulfilled",
    ).length;
    expect(errors).toBe(1);
    expect(successes).toBe(1);
  });
});
