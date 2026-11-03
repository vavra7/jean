import { FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../db/index.js";
import {
  ThreadListSchema,
  CreateThreadSchema,
  ThreadSchema,
  SwitchThreadModelSchema,
  MessageListSchema,
} from "@jean/shared";
import { requireAuthHandler } from "../auth.js";
import { camelizeKeys } from "../lib/camelize.js";

const IdParamsSchema = z.object({
  id: z.string().uuid(),
});

const PaginationQuerySchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export function registerThreadsRoutes(app: FastifyInstance): void {
  const typed = app
    .withTypeProvider<ZodTypeProvider>()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler);

  typed.get(
    "/api/threads",
    {
      schema: {
        querystring: z.object({}),
      },
    },
    async (req, reply) => {
      const auth = await requireAuthHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, title, selected_provider, selected_external_model_id, created_at, updated_at
           FROM threads
          WHERE user_id = $1
          ORDER BY updated_at DESC`,
        [auth.user.id],
      );
      return reply.send(ThreadListSchema.parse(rows.map(camelizeKeys)));
    },
  );

  typed.post(
    "/api/threads",
    {
      schema: {
        body: CreateThreadSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAuthHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const { title } = req.body;

      // Snapshot the user's last chosen model (may be null).
      const pool = getPool();
      const { rows: users } = await pool.query(
        "SELECT last_model_provider, last_model_external_id FROM users WHERE id = $1",
        [auth.user.id],
      );
      const snapshot = users[0] ?? {};

      const { rows } = await pool.query(
        `INSERT INTO threads (user_id, title, selected_provider, selected_external_model_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, selected_provider, selected_external_model_id, created_at, updated_at`,
        [
          auth.user.id,
          title ?? "New chat",
          snapshot.last_model_provider ?? null,
          snapshot.last_model_external_id ?? null,
        ],
      );
      return reply.status(201).send(ThreadSchema.parse(camelizeKeys(rows[0])));
    },
  );

  typed.get(
    "/api/threads/:id",
    {
      schema: {
        params: IdParamsSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAuthHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, title, selected_provider, selected_external_model_id, created_at, updated_at
           FROM threads
          WHERE id = $1 AND user_id = $2`,
        [req.params.id, auth.user.id],
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: "thread not found" });
      }
      return reply.send(ThreadSchema.parse(camelizeKeys(rows[0])));
    },
  );

  typed.delete(
    "/api/threads/:id",
    {
      schema: {
        params: IdParamsSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAuthHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const pool = getPool();
      const { rowCount } = await pool.query(
        "DELETE FROM threads WHERE id = $1 AND user_id = $2",
        [req.params.id, auth.user.id],
      );
      if (rowCount === 0) {
        return reply.status(404).send({ error: "thread not found" });
      }
      return reply.status(204).send();
    },
  );

  typed.get(
    "/api/threads/:id/messages",
    {
      schema: {
        params: IdParamsSchema,
        querystring: PaginationQuerySchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAuthHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const limit = Math.min(Number(req.query.limit ?? 50), 50);
      const pool = getPool();

      let beforeCreatedAt: Date | null = null;
      let beforeId: string | null = null;
      if (req.query.before) {
        const { rows: anchor } = await pool.query(
          "SELECT created_at, id FROM messages WHERE id = $1 AND thread_id = $2",
          [req.query.before, req.params.id],
        );
        if (anchor.length === 0) {
          return reply.status(404).send({ error: "message not found" });
        }
        beforeCreatedAt = anchor[0].created_at;
        beforeId = anchor[0].id;
      }

      // Verify the thread exists and is owned.
      const { rows: threads } = await pool.query(
        "SELECT 1 FROM threads WHERE id = $1 AND user_id = $2",
        [req.params.id, auth.user.id],
      );
      if (threads.length === 0) {
        return reply.status(404).send({ error: "thread not found" });
      }

      let messages;
      if (beforeCreatedAt) {
        const { rows } = await pool.query(
          `SELECT id, role, content, model, interrupted, created_at
             FROM messages
            WHERE thread_id = $1
              AND (created_at, id) < ($2, $3)
            ORDER BY created_at DESC, id DESC
            LIMIT $4`,
          [req.params.id, beforeCreatedAt, beforeId, limit],
        );
        messages = rows;
      } else {
        const { rows } = await pool.query(
          `SELECT id, role, content, model, interrupted, created_at
             FROM messages
            WHERE thread_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [req.params.id, limit],
        );
        messages = rows;
      }

      return reply.send(MessageListSchema.parse(messages.map(camelizeKeys)));
    },
  );

  typed.patch(
    "/api/threads/:id/model",
    {
      schema: {
        params: IdParamsSchema,
        body: SwitchThreadModelSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAuthHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const { provider, externalModelId } = req.body;

      const pool = getPool();

      // Validate the choice against the catalog.
      const { rows: catalog } = await pool.query(
        "SELECT 1 FROM models WHERE provider = $1 AND external_model_id = $2",
        [provider, externalModelId],
      );
      if (catalog.length === 0) {
        return reply.status(400).send({ error: "model not in catalog" });
      }

      // Ownership + update snapshot, and the user's last chosen model.
      const { rows } = await pool.query(
        `UPDATE threads
            SET selected_provider = $2, selected_external_model_id = $3, updated_at = now()
          WHERE id = $1 AND user_id = $4
          RETURNING id, title, selected_provider, selected_external_model_id, created_at, updated_at`,
        [req.params.id, provider, externalModelId, auth.user.id],
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: "thread not found" });
      }

      await pool.query(
        `UPDATE users
            SET last_model_provider = $2, last_model_external_id = $3
          WHERE id = $1`,
        [auth.user.id, provider, externalModelId],
      );

      return reply.send(ThreadSchema.parse(camelizeKeys(rows[0])));
    },
  );
}
