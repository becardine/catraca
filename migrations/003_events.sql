-- F02: events. Status transitions: draft -> published -> cancelled (cancelled is set only by F07).
CREATE TABLE events (
  id            text PRIMARY KEY,
  organizer_id  text NOT NULL REFERENCES users(id),
  name          text NOT NULL CHECK (length(trim(name)) > 0),
  venue         text NOT NULL CHECK (length(trim(venue)) > 0),
  starts_at     timestamptz NOT NULL,
  capacity      integer NOT NULL CHECK (capacity >= 1),
  price_cents   integer NOT NULL CHECK (price_cents > 0),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_organizer_idx ON events (organizer_id);
CREATE INDEX events_status_idx ON events (status);
