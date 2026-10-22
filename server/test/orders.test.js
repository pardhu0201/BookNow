'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const { setup, expireBooking } = require('./helpers');

const hold = (ctx, s, seatKey, eventId = ctx.eventId) =>
  ctx.api.post(`/api/events/${eventId}/holds`).set(s.header).send({ seatKey });

describe('orders: several seats, one checkout', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());
  beforeEach(() => ctx.reset());

  async function heldSeats(s, keys) {
    const ids = [];
    for (const k of keys) ids.push((await hold(ctx, s, k).expect(201)).body.id);
    return ids;
  }

  it('pays for three seats at once and confirms them together', async () => {
    const s = await ctx.session();
    const ids = await heldSeats(s, ['B1', 'B2', 'C1']);
    const res = await ctx.api.post('/api/checkout').set(s.header).send({ bookingIds: ids, email: 'trio@x.dev' }).expect(200);
    assert.match(res.body.url, new RegExp(`/checkout/${res.body.orderId}$`));

    const order = (await ctx.api.get(`/api/orders/${res.body.orderId}`).set(s.header).expect(200)).body;
    assert.equal(order.status, 'pending');
    assert.deepEqual(order.seats.map((x) => x.seatKey), ['B1', 'B2', 'C1']);
    assert.equal(order.totalMinor, 249900 * 2 + 149900);
    assert.ok(order.expiresAt);

    ctx.events.length = 0;
    const paid = (await ctx.api.post(`/api/orders/${res.body.orderId}/pay`).set(s.header).expect(200)).body;
    assert.equal(paid.status, 'confirmed');
    assert.equal(ctx.events.filter((e) => e.name === 'seat' && e.status === 'sold').length, 3);
    const notes = ctx.events.filter((e) => e.name === 'notify');
    assert.equal(notes.length, 1, 'one confirmation for the order, not one per seat');
    assert.match(notes[0].message, /seats B1, B2, C1/);
  });

  it('refuses seats from different shows, other people, or lapsed holds', async () => {
    const [a, b] = [await ctx.session(), await ctx.session()];
    const mine = await heldSeats(a, ['D1']);
    const theirs = await heldSeats(b, ['D2']);
    await ctx.api.post('/api/checkout').set(a.header).send({ bookingIds: [...mine, ...theirs], email: 'a@x.dev' }).expect(404);
    await ctx.api.post('/api/checkout').set(a.header).send({ bookingIds: [], email: 'a@x.dev' }).expect(400);
    await ctx.api.post('/api/checkout').set(a.header).send({ bookingIds: 'nope', email: 'a@x.dev' }).expect(400);
    await expireBooking(ctx.pool, mine[0]);
    const res = await ctx.api.post('/api/checkout').set(a.header).send({ bookingIds: mine, email: 'a@x.dev' }).expect(409);
    assert.equal(res.body.error.code, 'hold_expired');
  });

  it('keeps orders private to their buyer', async () => {
    const [a, b] = [await ctx.session(), await ctx.session()];
    const ids = await heldSeats(a, ['E2']);
    const { orderId } = (await ctx.api.post('/api/checkout').set(a.header).send({ bookingIds: ids, email: 'a@x.dev' })).body;
    await ctx.api.get(`/api/orders/${orderId}`).set(b.header).expect(404);
    await ctx.api.post(`/api/orders/${orderId}/pay`).set(b.header).expect(404);
    await ctx.api.get('/api/orders/not%20valid').set(a.header).expect(400);
  });

  it('refuses checkout once the show has started', async () => {
    const s = await ctx.session();
    const ids = await heldSeats(s, ['A6']);
    await ctx.pool.query(`UPDATE events SET starts_at = now() - interval '1 minute' WHERE id = $1`, [ctx.eventId]);
    const res = await ctx.api.post('/api/checkout').set(s.header).send({ bookingIds: ids, email: 's@x.dev' }).expect(409);
    assert.equal(res.body.error.code, 'show_started');
  });

  it('lists my tickets across shows, grouped by order', async () => {
    const s = await ctx.session();
    const ids = await heldSeats(s, ['A1', 'A2']);
    const { orderId } = (await ctx.api.post('/api/checkout').set(s.header).send({ bookingIds: ids, email: 'me@x.dev' })).body;
    await ctx.api.post(`/api/orders/${orderId}/pay`).set(s.header).expect(200);

    const { body } = await ctx.api.get('/api/me/tickets').set(s.header).expect(200);
    assert.equal(body.upcoming.length, 1);
    assert.deepEqual(body.upcoming[0].seats.map((x) => x.seatKey), ['A1', 'A2']);
    assert.equal(body.upcoming[0].totalMinor, 249900 * 2);
    assert.equal(body.upcoming[0].orderId, orderId);
    const stranger = await ctx.session();
    assert.deepEqual((await ctx.api.get('/api/me/tickets').set(stranger.header).expect(200)).body, { upcoming: [], past: [] });
  });

  it('waitlist: 404 for an unknown show (was a 500), 409 once a show has started', async () => {
    const s = await ctx.session();
    await ctx.api
      .post('/api/events/33333333-3333-3333-3333-333333333333/waitlist')
      .set(s.header)
      .send({ email: 'w@x.dev' })
      .expect(404);
    await ctx.pool.query(`UPDATE events SET starts_at = now() - interval '1 minute' WHERE id = $1`, [ctx.eventId]);
    const res = await ctx.api.post(`/api/events/${ctx.eventId}/waitlist`).set(s.header).send({ email: 'w@x.dev' }).expect(409);
    assert.equal(res.body.error.code, 'show_started');
  });
});

describe('Stripe webhook for a multi-seat order', () => {
  const secret = 'whsec_test_secret';
  let ctx;
  before(async () => {
    ctx = await setup({ payments: { provider: 'stripe', stripeSecretKey: 'sk_test_dummy', stripeWebhookSecret: secret } });
  });
  after(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('confirms every seat listed in the session metadata', async () => {
    const s = await ctx.session();
    const ids = [];
    for (const k of ['B4', 'B5']) ids.push((await hold(ctx, s, k).expect(201)).body.id);
    const payload = JSON.stringify({
      id: 'evt_multi',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_multi', payment_status: 'paid', payment_intent: 'pi_multi', metadata: { bookingIds: ids.join(',') } } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    await ctx.api.post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(payload).expect(200);
    const { rows } = await ctx.pool.query(`SELECT status, payment_ref FROM bookings WHERE id = ANY($1::uuid[])`, [ids]);
    assert.ok(rows.every((r) => r.status === 'confirmed' && r.payment_ref === 'cs_multi'));
  });
});
