import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { registerAdminUsersRoutes } from "./admin-users.js";
import { hashToken } from "../auth.js";
import { getPool } from "../db/index.js";

interface FakeUser {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: Date;
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
  seed: (user: FakeUser) => void;
  userRows: () => FakeUser[];
  deletedIds: () => string[];
}

vi.mock("../db/index.js", () => {
  const userRows: FakeUser[] = [];
  const deletedIds: string[] = [];
  let mutex: Promise<unknown> = Promise.resolve();

  function serialize<T>(fn: () => T): Promise<T> {
    const prev = mutex;
    mutex = prev.then(fn);
    return mutex as Promise<T>;
  }

  function runQuery(sql: string, params?: unknown[]) {
    const s = sql.replace(/\s+/g, " ");

    // sessions SELECT (requireAdminHandler / verifySession).
    // "admin-session" → admin; "non-admin-session" → regular user.
    if (s.includes("token_hash") && s.includes("JOIN users")) {
      const token = params?.[0];
      if (token === hashToken("non-admin-session")) {
        return {
          rows: [
            {
              id: "33333333-3333-3333-3333-333333333333",
              email: "viewer@example.com",
              display_name: null,
              is_admin: false,
              expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
            },
          ],
        };
      }
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

    // users list
    if (s.includes("FROM users ORDER BY created_at ASC")) {
      return { rows: [...userRows] };
    }

    // invites UPDATE used_at (delete cascade: clear creator, mark used)
    if (s.includes("UPDATE invites SET used_at")) {
      return { rowCount: 1 };
    }

    // users DELETE
    if (s.includes("DELETE FROM users WHERE id")) {
      deletedIds.push(String(params?.[0]));
      const idx = userRows.findIndex((r) => r.id === String(params?.[0]));
      if (idx !== -1) userRows.splice(idx, 1);
      return { rowCount: idx !== -1 ? 1 : 0 };
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
      userRows.length = 0;
      deletedIds.length = 0;
    },
    seed(user) {
      userRows.push(user);
    },
    userRows: () => userRows,
    deletedIds: () => deletedIds,
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
  registerAdminUsersRoutes(app);
  return app;
}

beforeEach(async () => {
  setValidEnv();
  const pool = mockGetPool();
  pool.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/users", () => {
  it("lists email, display name, admin flag and creation date", async () => {
    const pool = mockGetPool();
    pool.seed({
      id: "22222222-2222-2222-2222-222222222222",
      email: "alice@example.com",
      display_name: "Alice",
      is_admin: false,
      created_at: new Date("2026-01-01T00:00:00Z"),
    });
    pool.seed({
      id: adminId,
      email: "admin@example.com",
      display_name: null,
      is_admin: true,
      created_at: new Date("2026-01-02T00:00:00Z"),
    });

    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      cookies: { session: "admin-session" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0].email).toBe("alice@example.com");
    expect(body[0].displayName).toBe("Alice");
    expect(body[0].isAdmin).toBe(false);
    expect(body[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(body[1].email).toBe("admin@example.com");
    expect(body[1].isAdmin).toBe(true);
  });

  it("returns 401 without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/admin/users" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      cookies: { session: "non-admin-session" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /api/admin/users/:id", () => {
  it("deletes another user, cascades invites (used + creator cleared), returns 204", async () => {
    const pool = mockGetPool();
    pool.seed({
      id: "22222222-2222-2222-2222-222222222222",
      email: "alice@example.com",
      display_name: "Alice",
      is_admin: false,
      created_at: new Date(),
    });

    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/users/22222222-2222-2222-2222-222222222222",
      cookies: { session: "admin-session" },
    });
    expect(res.statusCode).toBe(204);
    expect(pool.deletedIds()).toContain("22222222-2222-2222-2222-222222222222");
    expect(pool.userRows()).toHaveLength(0);
  });

  it("returns 403 when deleting your own account", async () => {
    const pool = mockGetPool();
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${adminId}`,
      cookies: { session: "admin-session" },
    });
    expect(res.statusCode).toBe(403);
    expect(pool.deletedIds()).not.toContain(adminId);
    expect(pool.userRows()).toHaveLength(0);
  });

  it("returns 404 for an unknown user", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/users/99999999-9999-9999-9999-999999999999",
      cookies: { session: "admin-session" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without a session", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${adminId}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
