import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  displayName: text("display_name"),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  lastModelProvider: text("last_model_provider"),
  lastModelExternalId: text("last_model_external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
