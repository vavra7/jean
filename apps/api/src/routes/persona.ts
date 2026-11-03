import { FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../db/index.js";
import { requireAuthHandler } from "../auth.js";
import { PersonaSchema } from "@jean/shared";

export function registerPersonaRoutes(app: FastifyInstance): void {
  const typed = app
    .withTypeProvider<ZodTypeProvider>()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler);

  // Scoped to the caller: a user can only ever read their own Persona.
  typed.get(
    "/api/persona",
    { schema: {} },
    async (req, reply) => {
      const auth = await requireAuthHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const pool = getPool();
      const { rows } = await pool.query(
        "SELECT content FROM personas WHERE user_id = $1",
        [auth.user.id],
      );
      return reply.send(
        PersonaSchema.parse({ content: String(rows[0]?.content ?? "") }),
      );
    },
  );

  // Scoped to the caller: upserts the caller's Persona row only.
  typed.put(
    "/api/persona",
    {
      schema: {
        body: PersonaSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAuthHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const { content } = req.body;
      const pool = getPool();
      const { rows } = await pool.query(
        `INSERT INTO personas (user_id, content, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE
           SET content = EXCLUDED.content, updated_at = now()
         RETURNING content`,
        [auth.user.id, content],
      );
      return reply.send(PersonaSchema.parse({ content: String(rows[0].content) }));
    },
  );
}
