-- Walking skeleton: users table.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE,
  display_name text,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  last_model_provider text,
  last_model_external_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
