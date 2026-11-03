import { FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../db/index.js";
import { requireAdminHandler } from "../auth.js";
import { camelizeKeys } from "../lib/camelize.js";
import { UserListSchema } from "@jean/shared";

const IdParamsSchema = z.object({
  id: z.string().uuid(),
});

export function registerAdminUsersRoutes(app: FastifyInstance): void {
  const typed = app
    .withTypeProvider<ZodTypeProvider>()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler);

  // Admin: list every account (email, display name, admin flag, creation date).
  typed.get(
    "/api/admin/users",
    { schema: {} },
    async (req, reply) => {
      const auth = await requireAdminHandler(req.cookies);
      if ("status" in auth) {
        return reply
          .status(auth.status === 403 ? 403 : 401)
          .send({ error: auth.status === 403 ? "forbidden" : "not authenticated" });
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, email, display_name, is_admin, created_at
         FROM users
         ORDER BY created_at ASC`,
      );
      return reply.send(UserListSchema.parse(rows.map(camelizeKeys)));
    },
  );

  // Admin: delete an account. Cascades sessions, threads, messages and persona.
  // The admin cannot delete their own account. The deleted user's invites stay
  // listed as used with their creator cleared.
  typed.delete(
    "/api/admin/users/:id",
    {
      schema: {
        params: IdParamsSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAdminHandler(req.cookies);
      if ("status" in auth) {
        return reply
          .status(auth.status === 403 ? 403 : 401)
          .send({ error: auth.status === 403 ? "forbidden" : "not authenticated" });
      }

      const targetId = req.params.id;
      if (targetId === auth.user.id) {
        return reply.status(403).send({ error: "cannot delete your own account" });
      }

      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Mark the deleted user's invites used and clear their creator so they
        // remain listed (used) instead of being removed.
        await client.query(
          `UPDATE invites
           SET used_at = now(), created_by = NULL
           WHERE created_by = $1 AND used_at IS NULL`,
          [targetId],
        );

        // Deleting the user cascades to sessions, threads, messages and persona
        // via ON DELETE CASCADE foreign keys.
        const { rowCount } = await client.query(
          "DELETE FROM users WHERE id = $1",
          [targetId],
        );
        if (rowCount === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "user not found" });
        }

        await client.query("COMMIT");
        return reply.status(204).send();
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
