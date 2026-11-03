import { FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../db/index.js";
import {
  ProviderSchema,
  CreateModelSchema,
  ModelListSchema,
  ModelSchema,
  ModelTestRequestSchema,
  ModelTestResponseSchema,
} from "@jean/shared";
import { buildProviderRegistry } from "../providers/index.js";
import { getEnv } from "../env.js";
import { requireAdminHandler, requireAuthHandler } from "../auth.js";
import { camelizeKeys } from "../lib/camelize.js";

function getRegistry() {
  const env = getEnv();
  return buildProviderRegistry({
    NVIDIA_BASE_URL: env.NVIDIA_BASE_URL,
    NVIDIA_API_KEY: env.NVIDIA_API_KEY,
    OLLAMA_BASE_URL: env.OLLAMA_BASE_URL,
  });
}

const IdParamsSchema = z.object({
  id: z.string().uuid(),
});

const DiscoverQuerySchema = z.object({
  provider: ProviderSchema.optional(),
});

export function registerModelsRoutes(app: FastifyInstance): void {
  const typed = app
    .withTypeProvider<ZodTypeProvider>()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler);

  typed.get(
    "/api/models",
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
        "SELECT id, label, provider, external_model_id, created_at FROM models ORDER BY created_at DESC",
      );
      return reply.send(ModelListSchema.parse(rows.map(camelizeKeys)));
    },
  );

  typed.post(
    "/api/models",
    {
      schema: {
        body: CreateModelSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAdminHandler(req.cookies);
      if ("status" in auth) {
        return reply
          .status(auth.status === 403 ? 403 : 401)
          .send({ error: auth.status === 403 ? "forbidden" : "not authenticated" });
      }

      const { provider, externalModelId, label } = req.body;

      // Prove the model works before persisting anything.
      const providerImpl = getRegistry().get(provider);
      try {
        await providerImpl.testCompletion({ model: externalModelId });
      } catch (err) {
        if (err instanceof Error && err.name === "ProviderError") {
          return reply
            .status(422)
            .send({ error: err.message, hint: (err as any).hint });
        }
        return reply.status(422).send({ error: String(err) });
      }

      const pool = getPool();
      const { rows } = await pool.query(
        `INSERT INTO models (label, provider, external_model_id)
         VALUES ($1, $2, $3)
         RETURNING id, label, provider, external_model_id, created_at`,
        [label ?? externalModelId, provider, externalModelId],
      );
      return reply.status(201).send(ModelSchema.parse(camelizeKeys(rows[0])));
    },
  );

  typed.post(
    "/api/models/test",
    {
      schema: {
        body: ModelTestRequestSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAdminHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const { provider, externalModelId } = req.body;
      const providerImpl = getRegistry().get(provider);
      try {
        await providerImpl.testCompletion({ model: externalModelId });
        return reply.send(ModelTestResponseSchema.parse({ ok: true }));
      } catch (err) {
        if (err instanceof Error && err.name === "ProviderError") {
          return reply.send(
            ModelTestResponseSchema.parse({ ok: false, error: err.message }),
          );
        }
        return reply.send(
          ModelTestResponseSchema.parse({ ok: false, error: String(err) }),
        );
      }
    },
  );

  typed.get(
    "/api/models/discover",
    {
      schema: {
        querystring: DiscoverQuerySchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAdminHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      if (req.query.provider === "ollama") {
        const ids = await getRegistry().get("ollama").discoverModels!();
        return reply.send(ids);
      }
      return reply.send([]);
    },
  );

  typed.delete(
    "/api/models/:id",
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

      const pool = getPool();
      await pool.query("DELETE FROM models WHERE id = $1", [req.params.id]);
      return reply.status(204).send();
    },
  );
}
