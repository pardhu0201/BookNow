CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  seat_map JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  seat_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  price_cents INT NOT NULL DEFAULT 1000,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  seat_id UUID REFERENCES seats(id),
  user_email TEXT,
  amount_cents INT,
  stripe_session_id TEXT,
  status TEXT NOT NULL, -- pending, confirmed, cancelled
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  user_email TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
