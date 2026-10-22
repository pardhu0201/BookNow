'use strict';

const crypto = require('node:crypto');
const { withTransaction } = require('../db');
const { AppError } = require('../errors');
const { MOVIES, CITIES, LAYOUT, SHOW_TIMES, SHOW_DAYS } = require('../catalog-data');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SEATS_PER_SHOW = LAYOUT.rows.length * LAYOUT.seatsPerRow;

const istDate = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

// Deterministic per show, so a reset demo show refills the same way.
function seededRandom(seed) {
  let h = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Evening shows open busier than morning ones, like a real cinema.
function presoldFor(theatreId, time, date) {
  const rand = seededRandom(`${theatreId}|${time}|${date}`);
  const evening = time >= '18:00';
  const share = (evening ? 0.3 : 0.08) + rand() * (evening ? 0.45 : 0.3);
  return Math.round(SEATS_PER_SHOW * share);
}

function seatKeys() {
  return LAYOUT.rows.flatMap((row) => Array.from({ length: LAYOUT.seatsPerRow }, (_, i) => `${row.label}${i + 1}`));
}

function createCatalogService({ pool }) {
  // Upserts cities, theatres and movies, then adds the next SHOW_DAYS days of
  // shows. Safe to run on every boot and on a timer: existing slots are kept.
  async function syncCatalog(nowMs = Date.now()) {
    await withTransaction(pool, async (client) => {
      for (const [i, city] of CITIES.entries()) {
        await client.query(
          `INSERT INTO cities (slug, name, sort) VALUES ($1, $2, $3)
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, sort = EXCLUDED.sort`,
          [city.slug, city.name, i]
        );
        for (const t of city.theatres) {
          await client.query(
            `INSERT INTO theatres (id, city_slug, name, area, price_factor) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, area = EXCLUDED.area, price_factor = EXCLUDED.price_factor`,
            [t.id, city.slug, t.name, t.area, t.priceFactor]
          );
        }
      }
      for (const m of MOVIES) {
        await client.query(
          `INSERT INTO movies (id, tmdb_id, title, language, genres, runtime_minutes, certification, rating,
                               release_date, poster_url, backdrop_url, tmdb_url, director, top_cast, overview)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (id) DO UPDATE SET
             tmdb_id = EXCLUDED.tmdb_id, title = EXCLUDED.title, language = EXCLUDED.language, genres = EXCLUDED.genres,
             runtime_minutes = EXCLUDED.runtime_minutes, certification = EXCLUDED.certification, rating = EXCLUDED.rating,
             release_date = EXCLUDED.release_date, poster_url = EXCLUDED.poster_url, backdrop_url = EXCLUDED.backdrop_url,
             tmdb_url = EXCLUDED.tmdb_url, director = EXCLUDED.director, top_cast = EXCLUDED.top_cast, overview = EXCLUDED.overview`,
          [
            m.id, m.tmdbId, m.title, m.language, m.genres, m.runtimeMinutes, m.certification, m.rating,
            m.releaseDate, m.posterUrl, m.backdropUrl, m.tmdbUrl, m.director, m.cast, m.overview,
          ]
        );
      }

      const shows = { movie: [], theatre: [], screen: [], startsAt: [], name: [], venue: [], presold: [] };
      const movieById = new Map(MOVIES.map((m) => [m.id, m]));
      for (const city of CITIES) {
        city.theatres.forEach((theatre, ti) => {
          // Every theatre plays the city's two headline films, plus a rotating
          // pick of the rest.
          const [headline, rest] = [city.movies.slice(0, 2), city.movies.slice(2)];
          const rotated = [...rest.slice(ti % rest.length), ...rest.slice(0, ti % rest.length)];
          const lineup = [...headline, ...rotated.slice(0, ti === 0 ? 3 : 2)];
          lineup.forEach((movieId, mi) => {
            const movie = movieById.get(movieId);
            const times = [0, 2, 4].map((k) => SHOW_TIMES[(mi + ti + k) % SHOW_TIMES.length]).sort();
            for (let d = 0; d < SHOW_DAYS; d++) {
              const date = istDate(nowMs + d * 86_400_000);
              if (date < movie.releaseDate) continue;
              for (const time of times) {
                shows.movie.push(movieId);
                shows.theatre.push(theatre.id);
                shows.screen.push(`Audi ${mi + 1}`);
                shows.startsAt.push(`${date}T${time}:00+05:30`);
                shows.name.push(movie.title);
                shows.venue.push(`${theatre.name}, ${theatre.area}`);
                shows.presold.push(presoldFor(theatre.id, time, date));
              }
            }
          });
        });
      }
      await client.query(
        `INSERT INTO events (name, venue, starts_at, movie_id, theatre_id, screen, presold, total_seats, seats_ready)
         SELECT name, venue, starts_at, movie_id, theatre_id, screen, presold, $8, false
         FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[], $5::text[], $6::text[], $7::int[])
           AS s(name, venue, starts_at, movie_id, theatre_id, screen, presold)
         ON CONFLICT (theatre_id, screen, starts_at) WHERE theatre_id IS NOT NULL DO NOTHING`,
        [shows.name, shows.venue, shows.startsAt, shows.movie, shows.theatre, shows.screen, shows.presold, SEATS_PER_SHOW]
      );
      // Shows that ended over a day ago are no longer needed.
      await client.query(`DELETE FROM events WHERE movie_id IS NOT NULL AND starts_at < now() - interval '1 day'`);
    });
  }

  // Creates a show's seats on first use (with its pre-sold seats), so the
  // database holds seat rows only for shows someone has actually opened.
  async function ensureSeats(eventId) {
    const pre = (await pool.query('SELECT seats_ready FROM events WHERE id = $1', [eventId])).rows[0];
    if (!pre || pre.seats_ready) return;
    await withTransaction(pool, async (client) => {
      const show = (
        await client.query(
          `SELECT e.id, e.seats_ready, e.presold, COALESCE(t.price_factor, 1)::float AS factor
           FROM events e LEFT JOIN theatres t ON t.id = e.theatre_id WHERE e.id = $1 FOR UPDATE OF e`,
          [eventId]
        )
      ).rows[0];
      if (show.seats_ready) return; // another request created them first

      const keys = [];
      const rows = [];
      const numbers = [];
      const tiers = [];
      const prices = [];
      for (const row of LAYOUT.rows) {
        const price = Math.round((LAYOUT.basePriceRupees[row.tier] * show.factor) / 10) * 10 * 100;
        for (let n = 1; n <= LAYOUT.seatsPerRow; n++) {
          keys.push(`${row.label}${n}`);
          rows.push(row.label);
          numbers.push(n);
          tiers.push(row.tier);
          prices.push(price);
        }
      }
      await client.query(
        `INSERT INTO seats (event_id, seat_key, row_label, seat_number, tier, price_minor)
         SELECT $1::uuid, * FROM unnest($2::text[], $3::text[], $4::int[], $5::text[], $6::int[])`,
        [eventId, keys, rows, numbers, tiers, prices]
      );

      const rand = seededRandom(eventId);
      const shuffled = seatKeys().sort(() => rand() - 0.5);
      const sold = shuffled.slice(0, Math.min(show.presold, SEATS_PER_SHOW));
      await client.query(
        `WITH sold AS (
           UPDATE seats SET status = 'sold' WHERE event_id = $1 AND seat_key = ANY($2) RETURNING id, price_minor
         )
         INSERT INTO bookings (event_id, seat_id, session_id, amount_minor, status, source, expires_at)
         SELECT $1, id, 'seed', price_minor, 'confirmed', 'seed', now() FROM sold`,
        [eventId, sold]
      );
      await client.query('UPDATE events SET seats_ready = true WHERE id = $1', [eventId]);
    });
  }

  // Called before any hold: the show must exist and not have started.
  async function prepareShow(eventId) {
    const show = (
      await pool.query('SELECT seats_ready, (starts_at > now()) AS upcoming FROM events WHERE id = $1', [eventId])
    ).rows[0];
    if (!show) throw new AppError(404, 'event_not_found', 'Show not found.');
    if (!show.upcoming) throw new AppError(409, 'show_started', 'This show has already started.');
    if (!show.seats_ready) await ensureSeats(eventId);
  }

  async function listCities() {
    const { rows } = await pool.query(
      `SELECT c.slug, c.name, count(t.*)::int AS theatres
       FROM cities c LEFT JOIN theatres t ON t.city_slug = c.slug
       GROUP BY c.slug ORDER BY c.sort`
    );
    return rows;
  }

  async function cityOrThrow(slug) {
    const city = (await pool.query('SELECT slug, name FROM cities WHERE slug = $1', [slug])).rows[0];
    if (!city) throw new AppError(404, 'city_not_found', 'We are not in that city yet.');
    return city;
  }

  const movieFields = (m) => ({
    id: m.id,
    title: m.title,
    language: m.language,
    genres: m.genres,
    runtimeMinutes: m.runtime_minutes,
    certification: m.certification,
    rating: m.rating === null ? null : Number(m.rating),
    releaseDate: m.release_date,
    posterUrl: m.poster_url,
    backdropUrl: m.backdrop_url,
    tmdbUrl: m.tmdb_url,
    director: m.director,
    cast: m.top_cast,
    overview: m.overview,
  });

  async function moviesInCity(slug) {
    const city = await cityOrThrow(slug);
    const { rows } = await pool.query(
      `SELECT m.*, to_char(m.release_date, 'YYYY-MM-DD') AS release_date,
              count(e.*)::int AS shows, min(e.starts_at) AS next_show,
              m.release_date > (now() AT TIME ZONE 'Asia/Kolkata')::date AS advance
       FROM movies m
       JOIN events e ON e.movie_id = m.id AND e.starts_at > now()
       JOIN theatres t ON t.id = e.theatre_id AND t.city_slug = $1
       GROUP BY m.id
       ORDER BY advance, count(e.*) DESC, m.release_date DESC`,
      [slug]
    );
    return {
      city,
      movies: rows.map((m) => ({ ...movieFields(m), shows: m.shows, nextShow: m.next_show, advanceBooking: m.advance })),
    };
  }

  async function showtimes(slug, movieId, date) {
    const city = await cityOrThrow(slug);
    const movieRow = (
      await pool.query(`SELECT *, to_char(release_date, 'YYYY-MM-DD') AS release_date FROM movies WHERE id = $1`, [movieId])
    ).rows[0];
    if (!movieRow) throw new AppError(404, 'movie_not_found', 'Movie not found.');

    const dates = (
      await pool.query(
        `SELECT DISTINCT to_char(e.starts_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS d
         FROM events e JOIN theatres t ON t.id = e.theatre_id
         WHERE t.city_slug = $1 AND e.movie_id = $2 AND e.starts_at > now()
         ORDER BY d`,
        [slug, movieId]
      )
    ).rows.map((r) => r.d);
    const day = date && dates.includes(date) ? date : dates[0];

    const shows = day
      ? (
          await pool.query(
            `SELECT e.id, e.starts_at, e.screen, e.total_seats, t.id AS theatre_id, t.name, t.area,
                    CASE WHEN e.seats_ready THEN (
                      SELECT count(*) FROM seats s
                      WHERE s.event_id = e.id AND s.status = 'available'
                        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.seat_id = s.id AND b.status = 'held' AND b.expires_at > now())
                    ) ELSE e.total_seats - e.presold END::int AS available
             FROM events e JOIN theatres t ON t.id = e.theatre_id
             WHERE t.city_slug = $1 AND e.movie_id = $2 AND e.starts_at > now()
               AND e.starts_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Kolkata')
               AND e.starts_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
             ORDER BY t.name, e.starts_at`,
            [slug, movieId, day]
          )
        ).rows
      : [];

    const theatres = new Map();
    for (const s of shows) {
      if (!theatres.has(s.theatre_id)) theatres.set(s.theatre_id, { id: s.theatre_id, name: s.name, area: s.area, shows: [] });
      theatres.get(s.theatre_id).shows.push({
        id: s.id,
        startsAt: s.starts_at,
        screen: s.screen,
        available: s.available,
        total: s.total_seats,
      });
    }
    return { city, movie: movieFields(movieRow), dates, date: day ?? null, theatres: [...theatres.values()] };
  }

  // Movie and theatre details for a show's seat page; null for standalone events.
  async function showDetails(eventId) {
    const row = (
      await pool.query(
        `SELECT m.*, to_char(m.release_date, 'YYYY-MM-DD') AS release_date,
                t.id AS theatre_id, t.name AS theatre_name, t.area, c.slug AS city_slug, c.name AS city_name, e.screen
         FROM events e JOIN movies m ON m.id = e.movie_id
         JOIN theatres t ON t.id = e.theatre_id JOIN cities c ON c.slug = t.city_slug
         WHERE e.id = $1`,
        [eventId]
      )
    ).rows[0];
    if (!row) return null;
    return {
      movie: movieFields(row),
      theatre: { id: row.theatre_id, name: row.theatre_name, area: row.area },
      city: { slug: row.city_slug, name: row.city_name },
      screen: row.screen,
    };
  }

  return { syncCatalog, ensureSeats, prepareShow, listCities, moviesInCity, showtimes, showDetails };
}

module.exports = { createCatalogService, SEATS_PER_SHOW, istDate };
