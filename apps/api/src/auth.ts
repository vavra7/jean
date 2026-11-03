import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import argon2 from "argon2";
import { getPool } from "./db/index.js";
import { getEnv } from "./env.js";
import { AuthMeSchema } from "@jean/shared";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthedRequest {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    isAdmin: boolean;
  };
}

export function hashToken(token: string): string {
  return createHmac("sha256", getEnv().SESSION_SECRET).update(token).digest("hex");
}

export async function issueSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const pool = getPool();
  await pool.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt],
  );

  return { token, expiresAt };
}

export async function verifySession(
  token: string,
): Promise<AuthedRequest["user"] | null> {
  const tokenHash = hashToken(token);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.display_name, u.is_admin, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash],
  );

  const row = rows[0];
  if (!row) return null;

  if (new Date(row.expires_at) < new Date()) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    return null;
  }

  // Sliding expiry: extend on activity.
  await pool.query(
    "UPDATE sessions SET expires_at = $1 WHERE token_hash = $2",
    [new Date(Date.now() + SESSION_TTL_MS), tokenHash],
  );

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? null,
    isAdmin: Boolean(row.is_admin),
  };
}

function cookieOptions(): Record<string, unknown> {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

export function requireAuth(
  req: { headers: Record<string, string>; cookies: Record<string, string> },
): { user: AuthedRequest["user"] } | { status: 401 } {
  const token = req.cookies.session;
  if (!token) {
    return { status: 401 };
  }
  // verifySession is async; this is used inside async route handlers instead.
  throw new Error("use requireAuthHandler in async routes");
}

export async function requireAuthHandler(
  cookies: { session?: string },
): Promise<{ user: AuthedRequest["user"] } | { status: 401 }> {
  const token = cookies.session;
  if (!token) {
    return { status: 401 };
  }
  const user = await verifySession(token);
  if (!user) {
    return { status: 401 };
  }
  return { user };
}

export async function requireAdminHandler(
  cookies: { session?: string },
): Promise<{ user: AuthedRequest["user"] } | { status: 401 | 403 }> {
  const result = await requireAuthHandler(cookies);
  if ("status" in result) {
    return result;
  }
  if (!result.user.isAdmin) {
    return { status: 403 };
  }
  return { user: result.user };
}

export function publicOrigin(): string {
  return new URL(getEnv().PUBLIC_ORIGIN).origin;
}

/** Reject mutations carrying a foreign Origin header. Same-origin (no Origin) is allowed. */
export function checkOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }
  return origin === publicOrigin();
}

// Login rate limit: 5 attempts per 15 min per IP + email (in-memory).
const loginAttempts = new Map<
  string,
  { count: number; firstAttempt: number }
>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.firstAttempt + RATE_LIMIT_WINDOW_MS - now) / 1000),
    };
  }
  entry.count += 1;
  return { allowed: true };
}

const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance): void {
  app
    .withTypeProvider<ZodTypeProvider>()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler)
    .post(
      "/api/auth/login",
      {
        schema: {
          body: LoginBodySchema,
        },
      },
      async (req, reply) => {
        if (!checkOrigin(req.headers.origin)) {
          return reply.status(403).send({ error: "foreign origin" });
        }

        const key = `${req.ip ?? "unknown"}:${req.body.email}`;
        const limit = checkLoginRateLimit(key);
        if (!limit.allowed) {
          return reply.status(429).send({
            error: "too many attempts",
            retryAfter: limit.retryAfter,
          });
        }

        const pool = getPool();
        const { rows } = await pool.query(
          "SELECT id, email, password_hash, display_name, is_admin FROM users WHERE email = $1",
          [req.body.email],
        );
        const row = rows[0];

        // Identical 401 for unknown email or wrong password.
        if (!row) {
          return reply.status(401).send({ error: "invalid credentials" });
        }

        const valid = await argon2.verify(row.password_hash, req.body.password);
        if (!valid) {
          return reply.status(401).send({ error: "invalid credentials" });
        }

        const { token, expiresAt } = await issueSession(row.id);
        reply.setCookie("session", token, {
          ...cookieOptions(),
          expires: expiresAt,
        });

        return reply.send({
          id: row.id,
          email: row.email,
          displayName: row.display_name ?? null,
          isAdmin: Boolean(row.is_admin),
        });
      },
    )
    .post("/api/auth/logout", async (req, reply) => {
      if (!checkOrigin(req.headers.origin)) {
        return reply.status(403).send({ error: "foreign origin" });
      }

      const token = req.cookies.session;
      if (token) {
        const pool = getPool();
        await pool.query("DELETE FROM sessions WHERE token_hash = $1", [
          hashToken(token),
        ]);
      }
      reply.clearCookie("session", { path: "/" });
      return reply.send({ ok: true });
    })
    .get(
      "/api/auth/me",
      async (req, reply) => {
        const result = await requireAuthHandler(req.cookies);
        if ("status" in result) {
          return reply.status(401).send({ error: "not authenticated" });
        }
        return reply.send(AuthMeSchema.parse(result.user));
      },
    );
}
