import { FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../db/index.js";
import { requireAdminHandler, requireAuthHandler } from "../auth.js";
import { ScaffoldSchema } from "@jean/shared";

const UpsertScaffoldSql = `
  INSERT INTO app_settings (id, scaffold, updated_at)
  VALUES (1, $1, now())
  ON CONFLICT (id) DO UPDATE
    SET scaffold = EXCLUDED.scaffold, updated_at = now()
  RETURNING scaffold
`;

export function registerScaffoldRoutes(app: FastifyInstance): void {
  const typed = app
    .withTypeProvider<ZodTypeProvider>()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler);

  typed.get(
    "/api/admin/scaffold",
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
        "SELECT scaffold FROM app_settings WHERE id = 1",
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: "scaffold not seeded" });
      }
      return reply.send(ScaffoldSchema.parse({ scaffold: String(rows[0].scaffold) }));
    },
  );

  typed.put(
    "/api/admin/scaffold",
    {
      schema: {
        body: ScaffoldSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAdminHandler(req.cookies);
      if ("status" in auth) {
        return reply
          .status(auth.status === 403 ? 403 : 401)
          .send({ error: auth.status === 403 ? "forbidden" : "not authenticated" });
      }

      const { scaffold } = req.body;
      const pool = getPool();
      const { rows } = await pool.query(UpsertScaffoldSql, [scaffold]);
      return reply.send(ScaffoldSchema.parse({ scaffold: String(rows[0].scaffold) }));
    },
  );
}
