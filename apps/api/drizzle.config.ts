import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  verbose: true,
  dbCredentials: {
    connectionString: process.env.DATABASE_URL ?? "postgres://jean:jean@127.0.0.1:5432/jean",
  },
});
