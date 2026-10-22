'use strict';

const { withTransaction } = require('./db');

const DEMO_EVENT_ID = '00000000-0000-0000-0000-000000000001';

const ROWS = [
  { label: 'A', tier: 'Premium', priceMinor: 249900 },
  { label: 'B', tier: 'Premium', priceMinor: 249900 },
  { label: 'C', tier: 'Standard', priceMinor: 149900 },
  { label: 'D', tier: 'Standard', priceMinor: 149900 },
  { label: 'E', tier: 'Balcony', priceMinor: 79900 },
];
const SEATS_PER_ROW = 10;
const PRESOLD = ['A4', 'A5', 'B6', 'C2', 'C3', 'D8', 'E1', 'E10'];

async function markPresold(client, eventId) {
  const { rows } = await client.query(
    `UPDATE seats SET status = 'sold' WHERE event_id = $1 AND seat_key = ANY($2) RETURNING id, price_minor`,
    [eventId, PRESOLD]
  );
  for (const seat of rows) {
    await client.query(
      `INSERT INTO bookings (event_id, seat_id, session_id, amount_minor, status, source, expires_at)
       VALUES ($1, $2, 'seed', $3, 'confirmed', 'seed', now())`,
      [eventId, seat.id, seat.price_minor]
    );
  }
}

// Idempotent: creates the demo event (50 seats, 8 already sold) once.
async function seed(pool) {
  return withTransaction(pool, async (client) => {
    const created = await client.query(
      `INSERT INTO events (id, name, venue, starts_at)
       VALUES ($1, 'Indie Night Live', 'Riverside Arts Centre, Hyderabad',
               (date_trunc('day', (now() + interval '30 days') AT TIME ZONE 'Asia/Kolkata') + interval '19 hours')
                 AT TIME ZONE 'Asia/Kolkata')
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [DEMO_EVENT_ID]
    );
    if (!created.rowCount) return false;
    for (const row of ROWS) {
      for (let n = 1; n <= SEATS_PER_ROW; n++) {
        await client.query(
          `INSERT INTO seats (event_id, seat_key, row_label, seat_number, tier, price_minor)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [DEMO_EVENT_ID, `${row.label}${n}`, row.label, n, row.tier, row.priceMinor]
        );
      }
    }
    await markPresold(client, DEMO_EVENT_ID);
    return true;
  });
}

async function resetEvent(pool, eventId) {
  await withTransaction(pool, async (client) => {
    await client.query('DELETE FROM waitlist WHERE event_id = $1', [eventId]);
    await client.query('DELETE FROM bookings WHERE event_id = $1', [eventId]);
    const { rows } = await client.query('SELECT movie_id FROM events WHERE id = $1', [eventId]);
    if (rows[0]?.movie_id) {
      // Movie shows rebuild their seats (and pre-sold seats) on next open.
      await client.query('DELETE FROM seats WHERE event_id = $1', [eventId]);
      await client.query('UPDATE events SET seats_ready = false WHERE id = $1', [eventId]);
      return;
    }
    await client.query(`UPDATE seats SET status = 'available' WHERE event_id = $1`, [eventId]);
    await markPresold(client, eventId);
  });
}

module.exports = { seed, resetEvent, DEMO_EVENT_ID, PRESOLD };
