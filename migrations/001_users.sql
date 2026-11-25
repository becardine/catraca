-- Foundation table created by the harness so the seed can run.
-- F01 (accounts & access) builds sessions/auth on top of it.
CREATE TABLE users (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('organizer', 'participant')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
