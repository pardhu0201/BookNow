'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { toCsv } = require('../src/csv');

describe('API surface', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());
  beforeEach(() => ctx.reset());

  it('reports health and the payment mode', async () => {
    const res = await ctx.api.get('/api/health').expect(200);
    assert.deepEqual(res.body, { ok: true, payments: 'mock', demoMode: false });
  });

  it('serves the seat map the client expects', async () => {
    const res = await ctx.api.get(`/api/events/${ctx.eventId}`).expect(200);
    assert.equal(res.body.seats.length, 50);
    assert.deepEqual(res.body.counts, { total: 50, available: 42, held: 0, sold: 8 });
    assert.equal(res.body.event.name, 'Indie Night Live');
    assert.equal(res.body.payments, 'mock');
    const list = await ctx.api.get('/api/events').expect(200);
    assert.equal(list.body.events[0].unsoldSeats, 42);
    await ctx.api.get('/api/events/22222222-2222-2222-2222-222222222222').expect(404);
  });

  it('keeps the attendee export behind the admin token', async () => {
    const url = `/api/admin/events/${ctx.eventId}/attendees.csv`;
    await ctx.api.get(url).expect(401);
    await ctx.api.get(url).set('x-admin-token', 'wrong-token-value').expect(401);

    const s = await ctx.session();
    const { body } = await ctx.api.post(`/api/events/${ctx.eventId}/holds`).set(s.header).send({ seatKey: 'A1' }).expect(201);
    await ctx.api.post(`/api/holds/${body.id}/checkout`).set(s.header).send({ email: 'fan@x.dev' }).expect(200);
    await ctx.api.post(`/api/payments/mock/${body.id}`).set(s.header).expect(200);

    const res = await ctx.api.get(url).set('x-admin-token', 'test-admin-token').expect(200);
    assert.match(res.headers['content-type'], /text\/csv/);
    const lines = res.text.trim().split('\n');
    assert.equal(lines.length, 2, 'header plus the one real attendee; seeded sales are excluded');
    assert.match(lines[1], /fan@x\.dev,A1,Premium,249900,confirmed/);
  });

  it('escapes CSV cells that a spreadsheet would run as formulas', () => {
    const csv = toCsv(['a', 'b'], [['=HYPERLINK("http://evil")', 'plain, with comma']]);
    assert.equal(csv, 'a,b\n"\'=HYPERLINK(""http://evil"")","plain, with comma"\n');
  });

  it('returns JSON errors for unknown routes and malformed bodies', async () => {
    const s = await ctx.session();
    const missing = await ctx.api.get('/api/nope').expect(404);
    assert.equal(missing.body.error.code, 'not_found');
    const bad = await ctx.api
      .post(`/api/events/${ctx.eventId}/holds`)
      .set(s.header)
      .set('Content-Type', 'application/json')
      .send('{"seatKey":')
      .expect(400);
    assert.equal(bad.body.error.code, 'invalid_json');
  });

  it('sets security headers', async () => {
    const res = await ctx.api.get('/api/health').expect(200);
    assert.ok(res.headers['content-security-policy']);
    assert.equal(res.headers['x-powered-by'], undefined);
  });
});
