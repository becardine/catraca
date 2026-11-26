-- F03: tickets and the simulated gateway's persisted jobs.
CREATE TABLE tickets (
  id                text PRIMARY KEY,
  event_id          text NOT NULL REFERENCES events(id),
  buyer_user_id     text REFERENCES users(id),           -- null for partner API purchases
  buyer_email       text NOT NULL,
  code              text NOT NULL UNIQUE,
  status            text NOT NULL
                    CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'refunded')),
  price_cents_paid  integer NOT NULL CHECK (price_cents_paid > 0),  -- price snapshot (R03)
  channel           text NOT NULL CHECK (channel IN ('storefront', 'partner')),
  checked_in_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_buyer_idx ON tickets (buyer_user_id);

-- One job per ticket: the simulated gateway's answer, applied by the worker at due_at.
-- The full card number is never stored.
CREATE TABLE payment_jobs (
  ticket_id     text PRIMARY KEY REFERENCES tickets(id),
  approve       boolean NOT NULL,
  card_last4    text NOT NULL,
  due_at        timestamptz NOT NULL,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_jobs_due_idx ON payment_jobs (due_at) WHERE processed_at IS NULL;
