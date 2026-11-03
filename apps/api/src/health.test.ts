import { describe, expect, it } from "vitest";
import fastify from "fastify";
import { type ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { HealthResponseSchema } from "@jean/shared";
import { registerHealth } from "./routes/health.js";

describe("GET /api/health", () => {
  it("returns a payload matching the shared schema", async () => {
    const app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerHealth(app);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);

    const body = HealthResponseSchema.parse(JSON.parse(res.payload));
    expect(body.status).toBe("ok");
    expect(typeof body.value).toBe("string");
    expect(body.value.length).toBeGreaterThan(0);
  });
});
