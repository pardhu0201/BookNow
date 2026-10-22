'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, expireBooking } = require('./helpers');

describe('hold expiry and waitlist', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());
  beforeEach(() => ctx.reset());

  const hold = (s, seatKey) => ctx.api.post(`/api/events/${ctx.eventId}/holds`).set(s.header).send({ seatKey });
  const state = async (s) => (await ctx.api.get(`/api/events/${ctx.eventId}`).set(s.header).expect(200)).body;

  // Holds every unsold seat so the event is effectively sold out.
  async function fillHall() {
    const { rows } = await ctx.pool.query(`SELECT seat_key FROM seats WHERE status = 'available' ORDER BY seat_key`);
    const holders = [];
    for (let i = 0; i < rows.length; i += ctx.config.maxHoldsPerSession) {
      const s = await ctx.session();
      const ids = [];
      for (const r of rows.slice(i, i + ctx.config.maxHoldsPerSession)) {
        ids.push({ seatKey: r.seat_key, id: (await hold(s, r.seat_key).expect(201)).body.id });
      }
      holders.push({ s, ids });
    }
    return holders;
  }

  it('the sweeper expires lapsed holds and frees the seat', async () => {
    const s = await ctx.session();
    const { body } = await hold(s, 'B3').expect(201);
    await expireBooking(ctx.pool, body.id);
    assert.equal(await ctx.services.bookings.expireHolds(), 1);
    assert.equal((await state(s)).seats.find((x) => x.seatKey === 'B3').status, 'available');
    assert.equal(await ctx.services.locks.owner(ctx.eventId, 'B3'), null);
    assert.ok(ctx.events.some((e) => e.name === 'notify' && e.kind === 'hold_expired' && e.sessionId === s.id));
  });

  it('a lapsed but unswept hold does not block the next buyer', async () => {
    const [a, b] = [await ctx.session(), await ctx.session()];
    const { body } = await hold(a, 'C7').expect(201);
    await expireBooking(ctx.pool, body.id);
    await ctx.redis.del(ctx.services.locks.key(ctx.eventId, 'C7')); // Redis TTL ran out
    await hold(b, 'C7').expect(201);
    const { rows } = await ctx.pool.query('SELECT status FROM bookings WHERE id = $1', [body.id]);
    assert.equal(rows[0].status, 'expired');
  });

  it('only allows joining the waitlist when nothing is left', async () => {
    const s = await ctx.session();
    const res = await ctx.api.post(`/api/events/${ctx.eventId}/waitlist`).set(s.header).send({ email: 'a@x.dev' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'seats_available');
  });

  it('offers a released seat to the first person waiting, held in their own session', async () => {
    const holders = await fillHall();
    const [first, second] = [await ctx.session(), await ctx.session()];
    const join = (s, email) => ctx.api.post(`/api/events/${ctx.eventId}/waitlist`).set(s.header).send({ email });
    assert.equal((await join(first, 'first@x.dev').expect(201)).body.position, 1);
    assert.equal((await join(second, 'second@x.dev').expect(201)).body.position, 2);
    await join(first, 'first@x.dev').expect(201); // joining again keeps the place

    const { s, ids } = holders[0];
    ctx.events.length = 0;
    await ctx.api.delete(`/api/holds/${ids[0].id}`).set(s.header).expect(200);

    const view = await state(first);
    assert.equal(view.yourHolds.length, 1);
    assert.equal(view.yourHolds[0].seatKey, ids[0].seatKey);
    assert.equal(view.yourHolds[0].source, 'waitlist');
    const secondsLeft = (Date.parse(view.yourHolds[0].expiresAt) - Date.now()) / 1000;
    assert.ok(secondsLeft > ctx.config.waitlistHoldSeconds - 10 && secondsLeft <= ctx.config.waitlistHoldSeconds);
    // The freed seat was never announced as available to everyone else.
    assert.ok(!ctx.events.some((e) => e.name === 'seat' && e.status === 'available'));
    assert.ok(ctx.events.some((e) => e.name === 'notify' && e.kind === 'waitlist_offer' && e.sessionId === first.id));
    assert.equal((await state(second)).waitlist.position, 1);

    // The waitlisted visitor can actually pay for the offered seat.
    const checkout = await ctx.api
      .post(`/api/holds/${view.yourHolds[0].id}/checkout`)
      .set(first.header)
      .send({ email: 'first@x.dev' })
      .expect(200);
    assert.equal(checkout.body.provider, 'mock');
    await ctx.api.post(`/api/payments/mock/${view.yourHolds[0].id}`).set(first.header).expect(200);
    assert.equal((await state(first)).tickets[0].seatKey, ids[0].seatKey);
  });

  it('frees the seat for everyone when nobody is waiting', async () => {
    const s = await ctx.session();
    const { body } = await hold(s, 'D4').expect(201);
    await ctx.api.delete(`/api/holds/${body.id}`).set(s.header).expect(200);
    assert.ok(ctx.events.some((e) => e.name === 'seat' && e.seatKey === 'D4' && e.status === 'available'));
  });

  it('leaving the waitlist gives up the place', async () => {
    await fillHall();
    const s = await ctx.session();
    await ctx.api.post(`/api/events/${ctx.eventId}/waitlist`).set(s.header).send({ email: 'q@x.dev' }).expect(201);
    await ctx.api.delete(`/api/events/${ctx.eventId}/waitlist`).set(s.header).expect(200);
    assert.deepEqual((await state(s)).waitlist, { joined: false, position: null, length: 0 });
  });

  it('demo mode refills the hall once it has been sold out for a while', async () => {
    await ctx.pool.query(`UPDATE seats SET status = 'sold'`);
    await ctx.pool.query(
      `INSERT INTO bookings (event_id, seat_id, session_id, amount_minor, status, expires_at)
       SELECT s.event_id, s.id, 'x', s.price_minor, 'confirmed', now()
       FROM seats s WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.seat_id = s.id)`
    );
    assert.equal(await ctx.services.bookings.resetIfSoldOut(ctx.eventId, 3), false, 'too soon after the last sale');
    await ctx.pool.query(`UPDATE bookings SET updated_at = now() - interval '10 minutes'`);
    assert.equal(await ctx.services.bookings.resetIfSoldOut(ctx.eventId, 3), true);
    const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM seats WHERE status = 'available'`);
    assert.equal(rows[0].n, 42);
  });
});
