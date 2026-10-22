'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('seat holds', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());
  beforeEach(() => ctx.reset());

  const hold = (s, seatKey) => ctx.api.post(`/api/events/${ctx.eventId}/holds`).set(s.header).send({ seatKey });
  const seatOf = async (s, seatKey) => {
    const res = await ctx.api.get(`/api/events/${ctx.eventId}`).set(s ? s.header : {}).expect(200);
    return res.body.seats.find((x) => x.seatKey === seatKey);
  };

  it('holds a seat at the price stored on the seat', async () => {
    const s = await ctx.session();
    const premium = await hold(s, 'A1').expect(201);
    const balcony = await hold(s, 'E2').expect(201);
    assert.equal(premium.body.amountMinor, 249900);
    assert.equal(balcony.body.amountMinor, 79900);
    const seat = await seatOf(s, 'A1');
    assert.equal(seat.status, 'held');
    assert.equal(seat.heldByYou, true);
  });

  it('rejects a second visitor while the seat is held', async () => {
    const [a, b] = [await ctx.session(), await ctx.session()];
    await hold(a, 'B2').expect(201);
    const res = await hold(b, 'B2').expect(409);
    assert.equal(res.body.error.code, 'seat_held');
    assert.equal((await seatOf(b, 'B2')).heldByYou, false);
  });

  it('lets exactly one of 100 simultaneous buyers hold the same seat', async () => {
    const sessions = await Promise.all(Array.from({ length: 100 }, () => ctx.session()));
    const results = await Promise.all(sessions.map((s) => hold(s, 'C5')));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((code) => code === 201).length, 1);
    assert.equal(statuses.filter((code) => code === 409).length, 99);
    const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM bookings WHERE status = 'held'`);
    assert.equal(rows[0].n, 1);
  });

  it('caps holds per visitor, even when requests race', async () => {
    const s = await ctx.session();
    const seats = ['A1', 'A2', 'A3', 'A6', 'A7', 'A8', 'A9', 'A10'];
    const results = await Promise.all(seats.map((k) => hold(s, k)));
    assert.equal(results.filter((r) => r.status === 201).length, ctx.config.maxHoldsPerSession);
    assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'hold_limit'));
    // Rejected holds must not leave Redis locks behind.
    const other = await ctx.session();
    const freed = seats.filter((k, i) => results[i].status === 409);
    for (const k of freed) await hold(other, k).expect(201).catch(() => {});
    const { rows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM bookings WHERE status = 'held' AND session_id = $1`,
      [other.id]
    );
    assert.equal(rows[0].n, Math.min(freed.length, ctx.config.maxHoldsPerSession));
  });

  it('refuses sold seats, unknown seats and bad input', async () => {
    const s = await ctx.session();
    assert.equal((await hold(s, 'A4').expect(409)).body.error.code, 'seat_sold');
    assert.equal((await hold(s, 'Z9').expect(404)).body.error.code, 'seat_not_found');
    assert.equal((await hold(s, 'not-a-seat').expect(400)).body.error.code, 'invalid_input');
    await ctx.api.post('/api/events/not-a-uuid/holds').set(s.header).send({ seatKey: 'A1' }).expect(400);
    // A sold seat must not leave a Redis lock behind either.
    assert.equal(await ctx.services.locks.owner(ctx.eventId, 'A4'), null);
  });

  it('requires a valid server-issued session', async () => {
    await ctx.api.post(`/api/events/${ctx.eventId}/holds`).send({ seatKey: 'A1' }).expect(401);
    const forged = { Authorization: 'Bearer someone-else.forged-signature' };
    await ctx.api.post(`/api/events/${ctx.eventId}/holds`).set(forged).send({ seatKey: 'A1' }).expect(401);
  });

  it('only the holder can release a hold', async () => {
    const [owner, stranger] = [await ctx.session(), await ctx.session()];
    const { body } = await hold(owner, 'D1').expect(201);
    await ctx.api.delete(`/api/holds/${body.id}`).set(stranger.header).expect(404);
    assert.equal((await seatOf(owner, 'D1')).status, 'held');
    assert.equal(await ctx.services.locks.owner(ctx.eventId, 'D1'), owner.id);

    await ctx.api.delete(`/api/holds/${body.id}`).set(owner.header).expect(200);
    assert.equal((await seatOf(owner, 'D1')).status, 'available');
    assert.equal(await ctx.services.locks.owner(ctx.eventId, 'D1'), null);
    assert.ok(ctx.events.some((e) => e.name === 'seat' && e.seatKey === 'D1' && e.status === 'available'));
    await ctx.api.delete(`/api/holds/${body.id}`).set(owner.header).expect(409);
  });

  it('the database still blocks a second hold if Redis loses the lock', async () => {
    const [a, b] = [await ctx.session(), await ctx.session()];
    await hold(a, 'E5').expect(201);
    await ctx.redis.del(ctx.services.locks.key(ctx.eventId, 'E5'));
    const res = await hold(b, 'E5').expect(409);
    assert.equal(res.body.error.code, 'seat_held');
    assert.equal(await ctx.services.locks.owner(ctx.eventId, 'E5'), null, 'the failed attempt cleans up its lock');
  });

  it('broadcasts a hold only after it is committed', async () => {
    const s = await ctx.session();
    await hold(s, 'A4').expect(409);
    assert.equal(ctx.events.filter((e) => e.name === 'seat').length, 0);
    await hold(s, 'A1').expect(201);
    assert.deepEqual(
      ctx.events.filter((e) => e.name === 'seat').map((e) => [e.seatKey, e.status]),
      [['A1', 'held']]
    );
  });
});
