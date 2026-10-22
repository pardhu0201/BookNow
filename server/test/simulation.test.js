'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

// 120 visitors race for 50 seats at once: everyone grabs random seats and
// pays for whatever they get, some release, some let holds lapse. Afterwards
// the books must balance exactly.
describe('rush simulation', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());

  it('never sells a seat twice under 120 concurrent buyers', async () => {
    const { rows } = await ctx.pool.query('SELECT seat_key FROM seats ORDER BY seat_key');
    const seatKeys = rows.map((r) => r.seat_key);
    const pick = () => seatKeys[Math.floor(Math.random() * seatKeys.length)];

    async function visitor(i) {
      const s = await ctx.session();
      const outcomes = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await ctx.api.post(`/api/events/${ctx.eventId}/holds`).set(s.header).send({ seatKey: pick() });
        if (res.status !== 201) {
          outcomes.push(res.body.error.code);
          continue;
        }
        const id = res.body.id;
        if (i % 5 === 0) {
          await ctx.api.delete(`/api/holds/${id}`).set(s.header).expect(200);
          outcomes.push('released');
        } else if (i % 7 === 0) {
          await ctx.pool.query(`UPDATE bookings SET expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
          outcomes.push('lapsed');
        } else {
          await ctx.api.post(`/api/holds/${id}/checkout`).set(s.header).send({ email: `v${i}@x.dev` }).expect(200);
          const paid = await ctx.api.post(`/api/payments/mock/${id}`).set(s.header).expect(200);
          outcomes.push(paid.body.status);
        }
      }
      return outcomes;
    }

    const sweeping = (async () => {
      for (let i = 0; i < 20; i++) {
        await ctx.services.bookings.expireHolds();
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
    const outcomes = (await Promise.all(Array.from({ length: 120 }, (_, i) => visitor(i)))).flat();
    await sweeping;
    await ctx.services.bookings.expireHolds();

    const integrity = await ctx.services.bookings.integrity(ctx.eventId);
    assert.equal(integrity.seatsSoldTwice, 0);
    assert.equal(integrity.soldWithoutBooking, 0);
    assert.equal(integrity.soldSeats, integrity.confirmedBookings);
    assert.ok(integrity.ok);
    const confirmed = outcomes.filter((o) => o === 'confirmed').length;
    assert.equal(integrity.confirmedBookings, confirmed + 8, 'every confirmed payment plus the 8 seeded sales');
    assert.ok(outcomes.includes('seat_held') || outcomes.includes('seat_sold'), 'buyers really collided');
  });
});
