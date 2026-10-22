'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { istDate, SEATS_PER_SHOW } = require('../src/services/catalog');

describe('movie catalogue: city, movie, showtime, seats', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());
  beforeEach(async () => {
    await ctx.reset();
    await ctx.services.catalog.syncCatalog();
  });

  const firstShow = async (city = 'hyderabad', movie = 'drishyam-the-conclusion') => {
    const res = await ctx.api.get(`/api/cities/${city}/movies/${movie}/shows`).expect(200);
    return { body: res.body, show: res.body.theatres[0].shows[0], theatre: res.body.theatres[0] };
  };

  it('lists the five cities and their real theatres', async () => {
    const { body } = await ctx.api.get('/api/cities').expect(200);
    assert.deepEqual(
      body.cities.map((c) => c.slug),
      ['hyderabad', 'bengaluru', 'chennai', 'mumbai', 'delhi']
    );
    assert.ok(body.cities.every((c) => c.theatres === 3));
  });

  it('syncing twice does not duplicate shows', async () => {
    const count = async () => (await ctx.pool.query('SELECT count(*)::int AS n FROM events WHERE movie_id IS NOT NULL')).rows[0].n;
    const before = await count();
    await ctx.services.catalog.syncCatalog();
    assert.equal(await count(), before);
    assert.ok(before > 100);
  });

  it("lists a city's films with TMDB posters, and only films playing there", async () => {
    const { body } = await ctx.api.get('/api/cities/mumbai/movies').expect(200);
    const ids = body.movies.map((m) => m.id);
    assert.ok(ids.includes('drishyam-the-conclusion'));
    assert.ok(!ids.includes('baththa'), 'Baththa is not scheduled in Mumbai');
    assert.ok(body.movies.every((m) => m.posterUrl.startsWith('https://image.tmdb.org/t/p/w500/')));
    const today = istDate(Date.now());
    for (const m of body.movies) assert.equal(m.advanceBooking, m.releaseDate > today);
    await ctx.api.get('/api/cities/atlantis/movies').expect(404);
    await ctx.api.get('/api/cities/Bad%20City/movies').expect(400);
  });

  it('groups upcoming showtimes by theatre for a chosen day', async () => {
    const { body } = await firstShow('chennai', 'jailer-2');
    assert.ok(body.dates.length >= 1 && body.dates.length <= 3);
    assert.equal(body.date, body.dates[0]);
    assert.ok(body.theatres.length >= 1);
    for (const t of body.theatres) {
      for (const s of t.shows) {
        assert.ok(Date.parse(s.startsAt) > Date.now(), 'only upcoming shows are listed');
        assert.equal(s.total, SEATS_PER_SHOW);
        assert.ok(s.available > 0 && s.available <= s.total);
      }
    }
    const lastDay = body.dates.at(-1);
    const other = await ctx.api.get(`/api/cities/chennai/movies/jailer-2/shows?date=${lastDay}`).expect(200);
    assert.equal(other.body.date, lastDay);
  });

  it('creates seats once, even when 20 people open a new show at the same moment', async () => {
    const { show } = await firstShow();
    const results = await Promise.all(Array.from({ length: 20 }, () => ctx.api.get(`/api/events/${show.id}`)));
    assert.ok(results.every((r) => r.status === 200));
    const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM seats WHERE event_id = $1', [show.id]);
    assert.equal(rows[0].n, SEATS_PER_SHOW);
    const state = results[0].body;
    assert.equal(state.counts.total, SEATS_PER_SHOW);
    assert.equal(state.counts.available, show.available, 'listing and seat map agree');
    assert.equal(state.show.movie.id, 'drishyam-the-conclusion');
    assert.ok(state.show.theatre.name);
  });

  it("prices seats by tier and by the theatre's price level", async () => {
    const { body } = await ctx.api.get('/api/cities/hyderabad/movies/ranabaali/shows').expect(200);
    const amb = body.theatres.find((t) => t.id === 'amb-cinemas-gachibowli');
    assert.ok(amb, 'AMB Cinemas plays this film');
    const state = (await ctx.api.get(`/api/events/${amb.shows[0].id}`).expect(200)).body;
    const price = (tier) => state.seats.find((s) => s.tier === tier).priceMinor;
    assert.equal(price('Classic'), 23000); // 180 x 1.3, rounded to Rs 10
    assert.equal(price('Prime'), 34000); // 260 x 1.3
    assert.equal(price('Recliner'), 59000); // 450 x 1.3
  });

  it('holding a seat lowers the availability shown in the showtimes list', async () => {
    const { show } = await firstShow();
    const s = await ctx.session();
    const state = (await ctx.api.get(`/api/events/${show.id}`).set(s.header).expect(200)).body;
    const seat = state.seats.find((x) => x.status === 'available');
    await ctx.api.post(`/api/events/${show.id}/holds`).set(s.header).send({ seatKey: seat.seatKey }).expect(201);
    const after = await firstShow();
    assert.equal(after.show.available, show.available - 1);
  });

  it('a seat can be held without opening the seat map first', async () => {
    const { show } = await firstShow('delhi', 'prahaar');
    const s = await ctx.session();
    const res = await ctx.api.post(`/api/events/${show.id}/holds`).set(s.header).send({ seatKey: 'H12' });
    assert.ok([201, 409].includes(res.status), 'H12 is either free or pre-sold');
  });

  it('refuses holds once the show has started', async () => {
    const { show } = await firstShow();
    await ctx.pool.query(`UPDATE events SET starts_at = now() - interval '5 minutes' WHERE id = $1`, [show.id]);
    const s = await ctx.session();
    const res = await ctx.api.post(`/api/events/${show.id}/holds`).set(s.header).send({ seatKey: 'A1' }).expect(409);
    assert.equal(res.body.error.code, 'show_started');
  });

  it('demo mode refills a sold-out show from scratch', async () => {
    const { show } = await firstShow();
    await ctx.api.get(`/api/events/${show.id}`).expect(200);
    await ctx.pool.query(`UPDATE seats SET status = 'sold' WHERE event_id = $1`, [show.id]);
    await ctx.pool.query(
      `INSERT INTO bookings (event_id, seat_id, session_id, amount_minor, status, expires_at)
       SELECT s.event_id, s.id, 'x', s.price_minor, 'confirmed', now() FROM seats s
       WHERE s.event_id = $1 AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.seat_id = s.id)`,
      [show.id]
    );
    await ctx.pool.query(`UPDATE bookings SET updated_at = now() - interval '10 minutes' WHERE event_id = $1`, [show.id]);
    assert.equal(await ctx.services.bookings.resetSoldOutShows(3), 1);
    const state = (await ctx.api.get(`/api/events/${show.id}`).expect(200)).body;
    assert.equal(state.counts.available, show.available, 'same pre-sold pattern as before');
  });
});
