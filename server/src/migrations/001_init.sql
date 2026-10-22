CREATE TABLE events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  venue      TEXT NOT NULL,
  starts_at  TIMESTAMPTZ NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seat_key    TEXT NOT NULL,
  row_label   TEXT NOT NULL,
  seat_number INT  NOT NULL,
  tier        TEXT NOT NULL,
  price_minor INT  NOT NULL CHECK (price_minor > 0),
  status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold')),
  UNIQUE (event_id, seat_key)
);

CREATE TABLE bookings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seat_id      UUID NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  session_id   TEXT NOT NULL,
  email        TEXT,
  amount_minor INT  NOT NULL CHECK (amount_minor > 0),
  status       TEXT NOT NULL CHECK (status IN ('held', 'confirmed', 'released', 'expired', 'refund_required')),
  source       TEXT NOT NULL DEFAULT 'direct' CHECK (source IN ('direct', 'waitlist', 'seed')),
  payment_ref  TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The database, not just Redis, guarantees one live hold and one sale per seat.
CREATE UNIQUE INDEX bookings_one_hold_per_seat ON bookings (seat_id) WHERE status = 'held';
CREATE UNIQUE INDEX bookings_one_sale_per_seat ON bookings (seat_id) WHERE status = 'confirmed';
CREATE INDEX bookings_hold_expiry ON bookings (expires_at) WHERE status = 'held';
CREATE INDEX bookings_by_session ON bookings (session_id, status);

CREATE TABLE waitlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  email      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'left')),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX waitlist_one_entry_per_session ON waitlist (event_id, session_id) WHERE status = 'waiting';
CREATE INDEX waitlist_queue ON waitlist (event_id, created_at) WHERE status = 'waiting';
