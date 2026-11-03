import { randomBytes } from "node:crypto";
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
import {
  hashToken,
  publicOrigin,
  requireAdminHandler,
  SESSION_TTL_MS,
} from "./auth.js";
import {
  AcceptInviteSchema,
  AuthMeSchema,
  CreateInviteSchema,
  InviteListSchema,
} from "@jean/shared";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function inviteUrl(token: string): string {
  return `${publicOrigin()}/invite/${token}`;
}

class InviteError extends Error {
  constructor(public message: string, public status: number) {
    super(message);
    this.name = "InviteError";
  }
}

async function findInviteByToken(tokenHash: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, email, token_hash, expires_at, used_at, created_by, created_at
     FROM invites
     WHERE token_hash = $1`,
    [tokenHash],
  );
  return rows[0];
}

export async function createInvite(
  email: string,
  createdBy: string,
): Promise<{ url: string; email: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO invites (email, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, expires_at`,
    [email, tokenHash, expiresAt, createdBy],
  );

  return {
    url: inviteUrl(token),
    email: rows[0].email,
    expiresAt: new Date(rows[0].expires_at),
  };
}

export async function listInvites(): Promise<Array<{
  id: string;
  email: string;
  expiresAt: Date;
  usedAt: Date | null;
  used: boolean;
}>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, email, expires_at, used_at
     FROM invites
     ORDER BY created_at DESC`,
  );
  return rows.map((row) => {
    const usedAt = row.used_at ? new Date(row.used_at) : null;
    return {
      id: row.id,
      email: row.email,
      expiresAt: new Date(row.expires_at),
      usedAt,
      used: usedAt !== null,
    };
  });
}

/**
 * Accept an invite atomically: mark it used, create the account, and issue a
 * session, all in one transaction. The row is locked with FOR UPDATE so a
 * concurrent second accept cannot create a second account.
 */
export async function acceptInvite(
  token: string,
  displayName: string,
  password: string,
): Promise<{ user: { id: string; email: string; displayName: string; isAdmin: boolean }; token: string; expiresAt: Date }> {
  const tokenHash = hashToken(token);
  const pool = getPool();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the invite row so concurrent accepts serialize.
    const { rows } = await client.query(
      `SELECT id, email, expires_at, used_at
       FROM invites
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash],
    );
    const invite = rows[0];
    if (!invite) {
      await client.query("ROLLBACK");
      throw new InviteError("invalid invite", 401);
    }
    if (invite.used_at) {
      await client.query("ROLLBACK");
      throw new InviteError("invite already used", 401);
    }
    if (new Date(invite.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      throw new InviteError("invite expired", 401);
    }

    // Mark the invite used. The WHERE used_at IS NULL guard makes this a
    // no-op (and rowCount 0) if another transaction already marked it.
    const { rowCount: marked } = await client.query(
      `UPDATE invites SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
      [invite.id],
    );
    if (!marked) {
      await client.query("ROLLBACK");
      throw new InviteError("invite already used", 401);
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, display_name, password_hash, is_admin)
       VALUES ($1, $2, $3, false)
       RETURNING id, email, display_name, is_admin`,
      [invite.email, displayName, passwordHash],
    );
    const user = userRows[0];

    const sessionToken = randomBytes(32).toString("hex");
    const sessionHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, sessionHash, expiresAt],
    );

    await client.query("COMMIT");

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name ?? null,
        isAdmin: Boolean(user.is_admin),
      },
      token: sessionToken,
      expiresAt,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof InviteError) {
      throw err;
    }
    throw err;
  } finally {
    client.release();
  }
}

export function registerInvitesRoutes(app: FastifyInstance): void {
  const typed = app
    .withTypeProvider<ZodTypeProvider>()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler);

  // Admin: create a single-use invite for an email.
  typed.post(
    "/api/invites",
    {
      schema: {
        body: CreateInviteSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAdminHandler(req.cookies);
      if ("status" in auth) {
        return reply
          .status(auth.status === 403 ? 403 : 401)
          .send({ error: auth.status === 403 ? "forbidden" : "not authenticated" });
      }

      const { email } = req.body;
      const { url, expiresAt } = await createInvite(email, auth.user.id);
      return reply.send({ url, email, expiresAt });
    },
  );

  // Admin: list invites (email, expiry, used).
  typed.get(
    "/api/invites",
    {
      schema: {},
    },
    async (req, reply) => {
      const auth = await requireAdminHandler(req.cookies);
      if ("status" in auth) {
        return reply
          .status(auth.status === 403 ? 403 : 401)
          .send({ error: auth.status === 403 ? "forbidden" : "not authenticated" });
      }

      const invites = await listInvites();
      return reply.send(InviteListSchema.parse(invites));
    },
  );

  // Public: open a valid invite to learn the invited email (prefill).
  typed.get(
    "/api/invites/:token",
    {
      schema: {
        params: z.object({ token: z.string() }),
      },
    },
    async (req, reply) => {
      const invite = await findInviteByToken(hashToken(req.params.token));
      if (!invite) {
        return reply.status(401).send({ error: "invalid invite" });
      }
      if (invite.used_at) {
        return reply.status(401).send({ error: "invite already used" });
      }
      if (new Date(invite.expires_at) < new Date()) {
        return reply.status(401).send({ error: "invite expired" });
      }
      return reply.send({ email: invite.email });
    },
  );

  // Public: accept an invite — creates account + session, marks invite used.
  typed.post(
    "/api/invites/:token/accept",
    {
      schema: {
        params: z.object({ token: z.string() }),
        body: AcceptInviteSchema,
      },
    },
    async (req, reply) => {
      try {
        const { user, token, expiresAt } = await acceptInvite(
          req.params.token,
          req.body.displayName,
          req.body.password,
        );
        reply.setCookie("session", token, {
          httpOnly: true,
          sameSite: "lax" as const,
          path: "/",
          secure: process.env.NODE_ENV === "production",
          expires: expiresAt,
        });
        return reply.send(AuthMeSchema.parse(user));
      } catch (err) {
        if (err instanceof InviteError) {
          return reply.status(err.status).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
