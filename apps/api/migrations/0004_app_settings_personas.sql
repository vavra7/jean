-- Issue 07/08 data layer: personas and app_settings.
-- The default Scaffold is seeded into app_settings (issue 08) and precedes
-- the user's Persona in every system prompt (issue 06 / 07).

CREATE TABLE IF NOT EXISTS app_settings (
  id int PRIMARY KEY DEFAULT 1,
  scaffold text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS personas (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
