import { FastifyInstance } from "fastify";
import { type ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { HealthResponseSchema } from "@jean/shared";

export function registerHealth(app: FastifyInstance): void {
  app
    .withTypeProvider<ZodTypeProvider>()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler)
    .get(
      "/api/health",
      {
        schema: {
          response: {
            200: HealthResponseSchema,
          },
        },
      },
      async () => {
        return HealthResponseSchema.parse({ status: "ok", value: "jean is walking" });
      },
    );
}
