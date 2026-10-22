CREATE TABLE cities (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INT  NOT NULL DEFAULT 0
);

CREATE TABLE theatres (
  id           TEXT PRIMARY KEY,
  city_slug    TEXT NOT NULL REFERENCES cities(slug) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  area         TEXT NOT NULL,
  price_factor NUMERIC(4, 2) NOT NULL DEFAULT 1
);

CREATE TABLE movies (
  id              TEXT PRIMARY KEY,
  tmdb_id         INT,
  title           TEXT NOT NULL,
  language        TEXT NOT NULL,
  genres          TEXT[] NOT NULL DEFAULT '{}',
  runtime_minutes INT,
  certification   TEXT,
  rating          NUMERIC(3, 1),
  release_date    DATE NOT NULL,
  poster_url      TEXT,
  backdrop_url    TEXT,
  tmdb_url        TEXT,
  director        TEXT,
  top_cast        TEXT[] NOT NULL DEFAULT '{}',
  overview        TEXT
);

-- An "event" is now a show: a movie at a theatre, on a screen, at a time.
-- Standalone events (movie_id NULL) still work, as before.
ALTER TABLE events
  ADD COLUMN movie_id    TEXT REFERENCES movies(id) ON DELETE CASCADE,
  ADD COLUMN theatre_id  TEXT REFERENCES theatres(id) ON DELETE CASCADE,
  ADD COLUMN screen      TEXT,
  ADD COLUMN presold     INT NOT NULL DEFAULT 0,
  ADD COLUMN total_seats INT NOT NULL DEFAULT 0,
  -- Seat rows are created the first time someone opens a show.
  ADD COLUMN seats_ready BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX events_one_show_per_slot ON events (theatre_id, screen, starts_at) WHERE theatre_id IS NOT NULL;
CREATE INDEX events_by_movie ON events (movie_id, starts_at) WHERE movie_id IS NOT NULL;
CREATE INDEX theatres_by_city ON theatres (city_slug);
