import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(16),
  NVIDIA_API_KEY: z.string().min(1),
  NVIDIA_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:5173"),
  PORT: z.string().regex(/^\d+$/).default("3000"),
  HOST: z.string().default("127.0.0.1"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    console.error(
      `[api] Missing or invalid required env vars: ${missing}. Check .env against docs/PLAN.md.`,
    );
    process.exit(1);
  }

  return result.data;
}

/** Load env lazily so callers imported before dotenv.config() still see .env values. */
export function getEnv(): Env {
  return loadEnv();
}
