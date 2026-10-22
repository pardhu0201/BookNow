'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const { setup, expireBooking } = require('./helpers');

const hold = (ctx, s, seatKey) => ctx.api.post(`/api/events/${ctx.eventId}/holds`).set(s.header).send({ seatKey });
const checkout = (ctx, s, id, email = 'buyer@x.dev') =>
  ctx.api.post(`/api/holds/${id}/checkout`).set(s.header).send({ email });
const pay = (ctx, s, id) => ctx.api.post(`/api/payments/mock/${id}`).set(s.header);
const seatStatus = async (ctx, seatKey) =>
  (await ctx.pool.query('SELECT status FROM seats WHERE seat_key = $1', [seatKey])).rows[0].status;
const bookingStatus = async (ctx, id) =>
  (await ctx.pool.query('SELECT status FROM bookings WHERE id = $1', [id])).rows[0].status;

describe('checkout with the built-in mock provider', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('requires an email, then sells the seat on payment', async () => {
    const s = await ctx.session();
    const { body } = await hold(ctx, s, 'A1').expect(201);
    await checkout(ctx, s, body.id, 'not-an-email').expect(400);
    const res = await checkout(ctx, s, body.id).expect(200);
    assert.match(res.body.url, new RegExp(`/checkout/${res.body.orderId}$`));

    const paid = await pay(ctx, s, body.id).expect(200);
    assert.equal(paid.body.status, 'confirmed');
    assert.equal(await seatStatus(ctx, 'A1'), 'sold');
    assert.equal(await ctx.services.locks.owner(ctx.eventId, 'A1'), null);
    assert.ok(ctx.events.some((e) => e.name === 'seat' && e.seatKey === 'A1' && e.status === 'sold'));
  });

  it('paying twice is harmless', async () => {
    const s = await ctx.session();
    const { body } = await hold(ctx, s, 'A2').expect(201);
    await checkout(ctx, s, body.id).expect(200);
    await pay(ctx, s, body.id).expect(200);
    const again = await pay(ctx, s, body.id).expect(200);
    assert.equal(again.body.status, 'confirmed');
    assert.equal(ctx.events.filter((e) => e.name === 'seat' && e.status === 'sold').length, 1);
  });

  it('nobody else can check out or pay for your hold', async () => {
    const [owner, stranger] = [await ctx.session(), await ctx.session()];
    const { body } = await hold(ctx, owner, 'B1').expect(201);
    await checkout(ctx, stranger, body.id).expect(404);
    await checkout(ctx, owner, body.id).expect(200);
    await pay(ctx, stranger, body.id).expect(404);
    await ctx.api.get(`/api/bookings/${body.id}`).set(stranger.header).expect(404);
  });

  it('cannot start checkout once the hold has ended', async () => {
    const s = await ctx.session();
    const { body } = await hold(ctx, s, 'B2').expect(201);
    await expireBooking(ctx.pool, body.id);
    assert.equal((await checkout(ctx, s, body.id).expect(409)).body.error.code, 'hold_expired');
  });

  it('accepts a late payment if the seat is still free', async () => {
    const s = await ctx.session();
    const { body } = await hold(ctx, s, 'C1').expect(201);
    await checkout(ctx, s, body.id).expect(200);
    await expireBooking(ctx.pool, body.id);
    await ctx.services.bookings.expireHolds();
    const res = await pay(ctx, s, body.id).expect(200);
    assert.equal(res.body.status, 'confirmed');
    assert.equal(await seatStatus(ctx, 'C1'), 'sold');
  });

  it('refunds a late payment when someone else now holds the seat: no double sale', async () => {
    const [late, next] = [await ctx.session(), await ctx.session()];
    const first = (await hold(ctx, late, 'C4').expect(201)).body;
    await checkout(ctx, late, first.id).expect(200);
    await expireBooking(ctx.pool, first.id);
    await ctx.services.bookings.expireHolds();
    const second = (await hold(ctx, next, 'C4').expect(201)).body;

    const res = await pay(ctx, late, first.id).expect(200);
    assert.equal(res.body.status, 'refund_required');
    assert.equal(await bookingStatus(ctx, second.id), 'held', 'the new holder keeps their hold');
    assert.equal(await seatStatus(ctx, 'C4'), 'available');
    assert.ok(ctx.events.some((e) => e.name === 'notify' && e.kind === 'refund' && e.sessionId === late.id));

    await checkout(ctx, next, second.id).expect(200);
    assert.equal((await pay(ctx, next, second.id).expect(200)).body.status, 'confirmed');
    const integrity = await ctx.api
      .get(`/api/admin/events/${ctx.eventId}/integrity`)
      .set('x-admin-token', 'test-admin-token')
      .expect(200);
    assert.equal(integrity.body.ok, true);
    assert.equal(integrity.body.refundsRequired, 1);
  });

  it('the database refuses a second confirmed booking for a seat', async () => {
    const { rows } = await ctx.pool.query(`SELECT id, event_id FROM seats WHERE seat_key = 'A4'`);
    await assert.rejects(
      ctx.pool.query(
        `INSERT INTO bookings (event_id, seat_id, session_id, amount_minor, status, expires_at)
         VALUES ($1, $2, 'intruder', 100, 'confirmed', now())`,
        [rows[0].event_id, rows[0].id]
      ),
      /bookings_one_sale_per_seat/
    );
  });
});

describe('Stripe webhook', () => {
  const secret = 'whsec_test_secret';
  let ctx;
  before(async () => {
    ctx = await setup({ payments: { provider: 'stripe', stripeSecretKey: 'sk_test_dummy', stripeWebhookSecret: secret } });
  });
  after(() => ctx.close());
  beforeEach(() => ctx.reset());

  function signed(bookingId, overrides = {}) {
    const payload = JSON.stringify({
      id: 'evt_test_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', payment_status: 'paid', payment_intent: 'pi_test_1', metadata: { bookingId }, ...overrides } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return { payload, signature };
  }
  const deliver = ({ payload, signature }) =>
    ctx.api.post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(payload);

  it('verifies the signature against the raw body and confirms the booking', async () => {
    const s = await ctx.session();
    const { body } = await hold(ctx, s, 'D2').expect(201);
    await deliver(signed(body.id)).expect(200);
    assert.equal(await bookingStatus(ctx, body.id), 'confirmed');
    assert.equal(await seatStatus(ctx, 'D2'), 'sold');
    const { rows } = await ctx.pool.query('SELECT payment_ref FROM bookings WHERE id = $1', [body.id]);
    assert.equal(rows[0].payment_ref, 'cs_test_1');
  });

  it('rejects a bad signature and changes nothing', async () => {
    const s = await ctx.session();
    const { body } = await hold(ctx, s, 'D3').expect(201);
    const { payload } = signed(body.id);
    await deliver({ payload, signature: 't=1,v1=deadbeef' }).expect(400);
    assert.equal(await bookingStatus(ctx, body.id), 'held');
  });

  it('a replayed webhook does not sell the seat twice', async () => {
    const s = await ctx.session();
    const { body } = await hold(ctx, s, 'D5').expect(201);
    const event = signed(body.id);
    await Promise.all([deliver(event), deliver(event), deliver(event)]);
    const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM bookings WHERE status = 'confirmed' AND id = $1`, [body.id]);
    assert.equal(rows[0].n, 1);
    assert.equal(ctx.events.filter((e) => e.name === 'seat' && e.status === 'sold').length, 1);
  });

  it('ignores unpaid sessions and unknown bookings without erroring', async () => {
    const s = await ctx.session();
    const { body } = await hold(ctx, s, 'D6').expect(201);
    await deliver(signed(body.id, { payment_status: 'unpaid' })).expect(200);
    assert.equal(await bookingStatus(ctx, body.id), 'held');
    await deliver(signed('11111111-1111-1111-1111-111111111111')).expect(200);
  });

  it('mock payment routes are off when Stripe is configured', async () => {
    const s = await ctx.session();
    const { body } = await hold(ctx, s, 'D7').expect(201);
    await pay(ctx, s, body.id).expect(404);
  });
});
