const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const db = require('./db');
const redis = require('./redisClient');
const { acquireSeatLock, releaseSeatLock, getLockOwner } = require('./services/lock');
const { pushToWaitlist, popFromWaitlist } = require('./services/waitlist');
const { createCheckoutSession, stripe } = require('./services/stripe');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(bodyParser.json());

// simple mailer
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: false
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
});

// Lock endpoint
app.post('/api/lock', async (req, res) => {
  const { eventId, seatKey, userId, userEmail } = req.body;
  const ok = await acquireSeatLock(eventId, seatKey, userId, 600);
  if (!ok) return res.status(409).json({ error: 'Seat locked' });

  // broadcast lock
  io.emit('seat_locked', { eventId, seatKey, userId, expiresIn: 600 });
  // create a pending booking row with status pending
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const seatRow = await client.query('SELECT id, status FROM seats WHERE event_id=$1 AND seat_key=$2 FOR UPDATE', [eventId, seatKey]);
    if (seatRow.rows.length === 0) {
      await client.query('ROLLBACK');
      await releaseSeatLock(eventId, seatKey, userId);
      return res.status(404).json({ error: 'Seat not found' });
    }
    if (seatRow.rows[0].status !== 'available') {
      await client.query('ROLLBACK');
      await releaseSeatLock(eventId, seatKey, userId);
      return res.status(409).json({ error: 'Seat not available' });
    }
    // insert pending booking
    const insert = await client.query(
      `INSERT INTO bookings(event_id, seat_id, user_email, amount_cents, status, stripe_session_id)
       VALUES($1, $2, $3, $4, $5, $6) RETURNING id`,
      [eventId, seatRow.rows[0].id, userEmail, seatRow.rows[0].price_cents || 1000, 'pending', null]
    );
    await client.query('COMMIT');
    return res.json({ bookingId: insert.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    await releaseSeatLock(eventId, seatKey, userId);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Create Stripe checkout session
app.post('/api/create-checkout', async (req, res) => {
  const { bookingId, successUrl, cancelUrl } = req.body;
  const booking = (await db.query('SELECT b.*, s.price_cents, s.seat_key, s.id as seat_id FROM bookings b JOIN seats s ON b.seat_id=s.id WHERE b.id=$1', [bookingId])).rows[0];
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const session = await createCheckoutSession({
    priceCents: booking.price_cents,
    successUrl,
    cancelUrl,
    metadata: { bookingId: bookingId, eventId: booking.event_id, seatId: booking.seat_id }
  });
  await db.query('UPDATE bookings SET stripe_session_id=$1 WHERE id=$2', [session.id, bookingId]);
  res.json({ url: session.url });
});

// Stripe webhook to finalize booking
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bookingId = session.metadata.bookingId;
    // finalize booking inside DB transaction and release redis lock
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const booking = (await client.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [bookingId])).rows[0];
      if (!booking) { await client.query('ROLLBACK'); return res.status(404).end(); }
      if (booking.status === 'confirmed') { await client.query('COMMIT'); return res.status(200).end(); }
      // mark seat sold
      await client.query('UPDATE seats SET status=$1 WHERE id=$2', ['sold', booking.seat_id]);
      await client.query('UPDATE bookings SET status=$1 WHERE id=$2', ['confirmed', bookingId]);
      await client.query('COMMIT');
      // release any lock in redis for this seat
      // we stored userId as bookingId for lock owner earlier; attempt to delete any lock
      // broadcast seat confirmed
      io.emit('seat_confirmed', { eventId: booking.event_id, seatId: booking.seat_id });
      return res.status(200).end();
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(500).end();
    } finally {
      client.release();
    }
  }
  res.status(200).end();
});

// Release endpoint when user cancels or TTL expires
app.post('/api/release', async (req, res) => {
  const { eventId, seatKey, userId } = req.body;
  await releaseSeatLock(eventId, seatKey, userId);
  // mark seat available if pending booking exists cancel it
  // broadcast release
  io.emit('seat_released', { eventId, seatKey });
  // promote waitlist
  const next = await popFromWaitlist(eventId);
  if (next) {
    // send email and create a short hold for them
    const tempUserId = `waitlist:${Date.now()}`;
    await acquireSeatLock(eventId, seatKey, tempUserId, 300);
    transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: next,
      subject: 'Seat available for you',
      text: `A seat ${seatKey} is available. You have 5 minutes to complete booking.`
    });
    io.emit('seat_locked', { eventId, seatKey, userId: tempUserId, expiresIn: 300 });
  }
  res.json({ ok: true });
});

// Admin CSV export
app.get('/admin/export/attendees.csv', async (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendees.csv"');
  const rows = (await db.query('SELECT b.id, b.user_email, s.seat_key, b.amount_cents, b.status, b.created_at FROM bookings b JOIN seats s ON b.seat_id=s.id')).rows;
  res.write('booking_id,email,seat,amount_cents,status,created_at\n');
  for (const r of rows) {
    res.write(`${r.id},${r.user_email},${r.seat_key},${r.amount_cents},${r.status},${r.created_at.toISOString()}\n`);
  }
  res.end();
});

server.listen(4000, () => console.log('Server listening on 4000'));
