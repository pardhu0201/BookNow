'use strict';

const { withTransaction } = require('../db');
const { AppError } = require('../errors');
const { resetEvent } = require('../seed');

const UNIQUE_VIOLATION = '23505';
// A hold whose Redis lock has lapsed may not have been swept yet; treat it as
// expired if it ends within this window so the next buyer is not blocked.
const STALE_HOLD_GRACE = "interval '2 seconds'";

const seatList = (keys) => (keys.length === 1 ? `seat ${keys[0]}` : `seats ${keys.join(', ')}`);
const seatHeld = () => new AppError(409, 'seat_held', 'Someone else is holding this seat right now.');
const bookingNotFound = () => new AppError(404, 'booking_not_found', 'Booking not found.');

function toHold(row) {
  return {
    id: row.id,
    seatKey: row.seat_key,
    amountMinor: row.amount_minor,
    expiresAt: row.expires_at,
    source: row.source,
  };
}

// Lock order everywhere: seat row before booking rows. Keeping one order
// means a hold and a late payment on the same seat cannot deadlock.
function createBookingService({ pool, locks, payments, mailer, bus, config, catalog }) {
  async function holdSeat({ eventId, seatKey, sessionId, source = 'direct', ttlSeconds = config.holdSeconds }) {
    await catalog.prepareShow(eventId);
    // Fast path: Redis SET NX turns away contention without touching Postgres.
    if (!(await locks.acquire(eventId, seatKey, sessionId, ttlSeconds))) throw seatHeld();

    let hold;
    try {
      hold = await withTransaction(pool, async (client) => {
        // Serialises one visitor's parallel requests so the hold limit holds.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`session:${sessionId}`]);
        const seat = (
          await client.query(
            'SELECT id, seat_key, status, price_minor FROM seats WHERE event_id = $1 AND seat_key = $2 FOR UPDATE',
            [eventId, seatKey]
          )
        ).rows[0];
        if (!seat) throw new AppError(404, 'seat_not_found', 'No such seat for this event.');
        if (seat.status === 'sold') throw new AppError(409, 'seat_sold', 'This seat is already sold.');

        const active = await client.query(
          `SELECT count(*)::int AS n FROM bookings WHERE session_id = $1 AND status = 'held' AND expires_at > now()`,
          [sessionId]
        );
        if (active.rows[0].n >= config.maxHoldsPerSession) {
          throw new AppError(409, 'hold_limit', `You can hold at most ${config.maxHoldsPerSession} seats at a time.`);
        }

        await client.query(
          `UPDATE bookings SET status = 'expired', updated_at = now()
           WHERE seat_id = $1 AND status = 'held' AND expires_at <= now() + ${STALE_HOLD_GRACE}`,
          [seat.id]
        );
        // Price comes from the seat row (the old code always charged 1000).
        const inserted = await client.query(
          `INSERT INTO bookings (event_id, seat_id, session_id, amount_minor, status, source, expires_at)
           VALUES ($1, $2, $3, $4, 'held', $5, now() + ($6::int * interval '1 second'))
           RETURNING id, amount_minor, expires_at, source`,
          [eventId, seat.id, sessionId, seat.price_minor, source, ttlSeconds]
        );
        return { ...inserted.rows[0], seat_key: seat.seat_key };
      });
    } catch (err) {
      await locks.release(eventId, seatKey, sessionId).catch(() => {});
      // Safety net: Redis lost the lock (restart, eviction) but the DB still
      // has a live hold, so the partial unique index rejects the second one.
      if (err.code === UNIQUE_VIOLATION) throw seatHeld();
      throw err;
    }

    // Broadcast only after commit; the old code announced locks it then rolled back.
    bus.emit('seat', { eventId, seatKey, status: 'held' });
    bus.emit('activity', { eventId, type: 'held', seatKey });
    return toHold(hold);
  }

  async function releaseHold({ bookingId, sessionId }) {
    const booking = await withTransaction(pool, async (client) => {
      const row = (
        await client.query(
          `SELECT b.id, b.event_id, b.status, b.session_id, s.seat_key
           FROM bookings b JOIN seats s ON s.id = b.seat_id WHERE b.id = $1 FOR UPDATE OF b`,
          [bookingId]
        )
      ).rows[0];
      // Same answer for "missing" and "not yours", so ids cannot be probed.
      if (!row || row.session_id !== sessionId) throw bookingNotFound();
      if (row.status !== 'held') throw new AppError(409, 'not_held', `This booking is ${row.status}, not held.`);
      await client.query(`UPDATE bookings SET status = 'released', updated_at = now() WHERE id = $1`, [bookingId]);
      return row;
    });

    await locks.release(booking.event_id, booking.seat_key, sessionId);
    bus.emit('activity', { eventId: booking.event_id, type: 'released', seatKey: booking.seat_key });
    await seatFreed(booking.event_id, booking.seat_key);
    return { id: bookingId, status: 'released' };
  }

  // The waitlist gets first claim on a freed seat, before anyone is told it is free.
  async function seatFreed(eventId, seatKey) {
    const offered = await offerToWaitlist(eventId, seatKey);
    if (!offered) bus.emit('seat', { eventId, seatKey, status: 'available' });
  }

  async function offerToWaitlist(eventId, seatKey) {
    const entry = (
      await pool.query(
        `UPDATE waitlist SET status = 'offered', updated_at = now()
         WHERE id = (
           SELECT id FROM waitlist WHERE event_id = $1 AND status = 'waiting'
           ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING id, session_id, email`,
        [eventId]
      )
    ).rows[0];
    if (!entry) return false;

    let hold;
    try {
      // Held for the waitlisted visitor's own session, so they can pay for it
      // (the old code held it for a random id nobody knew, blocking everyone).
      hold = await holdSeat({
        eventId,
        seatKey,
        sessionId: entry.session_id,
        source: 'waitlist',
        ttlSeconds: config.waitlistHoldSeconds,
      });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      await pool.query(`UPDATE waitlist SET status = 'waiting', updated_at = now() WHERE id = $1`, [entry.id]);
      return false;
    }

    await pool.query('UPDATE waitlist SET booking_id = $2 WHERE id = $1', [entry.id, hold.id]);
    const minutes = Math.round(config.waitlistHoldSeconds / 60);
    bus.emit('notify', {
      sessionId: entry.session_id,
      kind: 'waitlist_offer',
      message: `Good news: seat ${seatKey} is reserved for you for ${minutes} minutes.`,
    });
    void mailer.send({
      to: entry.email,
      subject: `Seat ${seatKey} is reserved for you`,
      text: `A seat opened up. Seat ${seatKey} is held for you for ${minutes} minutes.\n\nComplete your booking: ${config.appUrl}/`,
    });
    return true;
  }

  async function expireHolds() {
    const { rows } = await pool.query(
      `UPDATE bookings b SET status = 'expired', updated_at = now()
       FROM seats s
       WHERE s.id = b.seat_id AND b.status = 'held' AND b.expires_at <= now()
       RETURNING b.id, b.event_id, b.session_id, s.seat_key`
    );
    for (const row of rows) {
      await locks.release(row.event_id, row.seat_key, row.session_id);
      bus.emit('notify', {
        sessionId: row.session_id,
        kind: 'hold_expired',
        message: `Your hold on seat ${row.seat_key} expired.`,
      });
      bus.emit('activity', { eventId: row.event_id, type: 'expired', seatKey: row.seat_key });
      await seatFreed(row.event_id, row.seat_key);
    }
    return rows.length;
  }

  // One checkout (an "order") for several held seats of the same show. The
  // order id is the payment reference shared by its bookings.
  async function startCheckout({ bookingIds, sessionId, email }) {
    const ids = [...new Set(bookingIds)];
    if (ids.length === 0 || ids.length > config.maxHoldsPerSession) {
      throw new AppError(400, 'invalid_input', `Choose between 1 and ${config.maxHoldsPerSession} held seats.`);
    }
    const { rows } = await pool.query(
      `SELECT b.*, s.seat_key, s.tier, s.row_label, s.seat_number, e.name AS event_name,
              (b.expires_at > now()) AS active, (e.starts_at > now()) AS upcoming
       FROM bookings b JOIN seats s ON s.id = b.seat_id JOIN events e ON e.id = b.event_id
       WHERE b.id = ANY($1::uuid[])
       ORDER BY s.row_label, s.seat_number`,
      [ids]
    );
    if (rows.length !== ids.length || rows.some((r) => r.session_id !== sessionId)) throw bookingNotFound();
    if (new Set(rows.map((r) => r.event_id)).size > 1) {
      throw new AppError(400, 'invalid_input', 'All seats in one checkout must be for the same show.');
    }
    if (rows.some((r) => r.status !== 'held' || !r.active)) {
      throw new AppError(409, 'hold_expired', 'Your hold has ended. Pick the seat again.');
    }
    if (!rows[0].upcoming) throw new AppError(409, 'show_started', 'This show has already started.');

    const checkout = await payments.createCheckout({
      bookings: rows,
      email,
      eventId: rows[0].event_id,
      eventName: rows[0].event_name,
    });
    await pool.query(
      `UPDATE bookings SET email = $2, payment_ref = $3, updated_at = now() WHERE id = ANY($1::uuid[])`,
      [ids, email, checkout.ref]
    );
    return { url: checkout.url, orderId: checkout.ref, provider: payments.provider };
  }

  function orderStatus(statuses) {
    if (statuses.every((s) => s === 'confirmed')) return 'confirmed';
    if (statuses.includes('held')) return 'pending';
    if (statuses.includes('confirmed')) return 'partial';
    if (statuses.includes('refund_required')) return 'refund_required';
    return 'expired';
  }

  async function getOrder({ orderId, sessionId }) {
    const { rows } = await pool.query(
      `SELECT b.id, b.event_id, b.session_id, b.status, b.amount_minor, b.email, b.expires_at,
              (b.expires_at > now()) AS active, now() AS db_now, s.seat_key, s.tier,
              e.name AS event_name, e.venue, e.starts_at, e.currency
       FROM bookings b JOIN seats s ON s.id = b.seat_id JOIN events e ON e.id = b.event_id
       WHERE b.payment_ref = $1
       ORDER BY s.row_label, s.seat_number`,
      [orderId]
    );
    if (!rows.length || rows.some((r) => r.session_id !== sessionId)) {
      throw new AppError(404, 'order_not_found', 'Order not found.');
    }
    const seats = rows.map((r) => ({
      bookingId: r.id,
      seatKey: r.seat_key,
      tier: r.tier,
      amountMinor: r.amount_minor,
      status: r.status === 'held' && !r.active ? 'expired' : r.status,
    }));
    const held = rows.filter((r) => r.status === 'held' && r.active);
    return {
      orderId,
      eventId: rows[0].event_id,
      status: orderStatus(seats.map((s) => s.status)),
      seats,
      totalMinor: seats.reduce((sum, s) => sum + s.amountMinor, 0),
      currency: rows[0].currency,
      email: rows[0].email,
      eventName: rows[0].event_name,
      venue: rows[0].venue,
      startsAt: rows[0].starts_at,
      show: await catalog.showDetails(rows[0].event_id),
      expiresAt: held.length ? new Date(Math.min(...held.map((r) => r.expires_at.getTime()))).toISOString() : null,
      serverTime: rows[0].db_now.toISOString(),
    };
  }

  // Confirms every seat of an order, then tells the buyer once (not per seat).
  async function confirmOrder({ bookingIds, paymentRef, paymentIntent }) {
    const results = [];
    for (const bookingId of bookingIds) {
      results.push({ bookingId, ...(await confirmPayment({ bookingId, paymentRef, paymentIntent, quiet: true })) });
    }
    const fresh = results.filter((r) => r.changed);
    if (fresh.length) {
      const { rows } = await pool.query(
        `SELECT b.session_id, b.email, e.name, s.seat_key, b.status
         FROM bookings b JOIN seats s ON s.id = b.seat_id JOIN events e ON e.id = b.event_id
         WHERE b.id = ANY($1::uuid[]) ORDER BY s.row_label, s.seat_number`,
        [fresh.map((r) => r.bookingId)]
      );
      const sold = rows.filter((r) => r.status === 'confirmed').map((r) => r.seat_key);
      const refunded = rows.filter((r) => r.status === 'refund_required').map((r) => r.seat_key);
      const { session_id: sessionId, email, name } = rows[0];
      if (sold.length) {
        bus.emit('notify', { sessionId, kind: 'booking_confirmed', message: `Booking confirmed: ${seatList(sold)}.` });
        void mailer.send({
          to: email,
          subject: `Your BookNow tickets: ${name}, ${seatList(sold)}`,
          text: `Your booking is confirmed for ${name}: ${seatList(sold)}. Order ${paymentRef}.`,
        });
      }
      if (refunded.length) {
        bus.emit('notify', {
          sessionId,
          kind: 'refund',
          message: `${seatList(refunded)} went to someone else after your hold expired. Those seats will be refunded.`,
        });
        void mailer.send({
          to: email,
          subject: `Refund for ${seatList(refunded)}`,
          text: `Your hold expired before payment completed and ${seatList(refunded)} went to someone else. You will be refunded for those seats.`,
        });
      }
    }
    return results.map(({ bookingId, status }) => ({ bookingId, status }));
  }

  async function payOrder({ orderId, sessionId }) {
    const order = await getOrder({ orderId, sessionId });
    await confirmOrder({ bookingIds: order.seats.map((s) => s.bookingId), paymentRef: orderId });
    return getOrder({ orderId, sessionId });
  }

  async function myTickets({ sessionId }) {
    const { rows } = await pool.query(
      `SELECT b.id, b.payment_ref, b.status, b.amount_minor, b.updated_at, s.seat_key, s.tier,
              e.id AS event_id, e.name, e.venue, e.starts_at, e.currency, e.screen,
              m.title, m.poster_url, m.language, m.certification, t.name AS theatre, t.area
       FROM bookings b JOIN seats s ON s.id = b.seat_id JOIN events e ON e.id = b.event_id
       LEFT JOIN movies m ON m.id = e.movie_id LEFT JOIN theatres t ON t.id = e.theatre_id
       WHERE b.session_id = $1 AND b.status IN ('confirmed', 'refund_required')
       ORDER BY e.starts_at, s.row_label, s.seat_number`,
      [sessionId]
    );
    const orders = new Map();
    for (const r of rows) {
      const key = `${r.payment_ref ?? r.id}|${r.event_id}`;
      if (!orders.has(key)) {
        orders.set(key, {
          orderId: r.payment_ref ?? r.id,
          eventId: r.event_id,
          title: r.title ?? r.name,
          posterUrl: r.poster_url,
          language: r.language,
          certification: r.certification,
          theatre: r.theatre ? `${r.theatre}, ${r.area}` : r.venue,
          screen: r.screen,
          startsAt: r.starts_at,
          currency: r.currency,
          seats: [],
          totalMinor: 0,
          refundedSeats: [],
        });
      }
      const o = orders.get(key);
      if (r.status === 'confirmed') {
        o.seats.push({ seatKey: r.seat_key, tier: r.tier });
        o.totalMinor += r.amount_minor;
      } else {
        o.refundedSeats.push(r.seat_key);
      }
    }
    const list = [...orders.values()];
    const now = Date.now();
    return {
      upcoming: list.filter((o) => new Date(o.startsAt).getTime() > now),
      past: list.filter((o) => new Date(o.startsAt).getTime() <= now).reverse(),
    };
  }

  // Idempotent: Stripe retries webhooks, and a retry must not sell twice.
  // quiet: the caller (an order) sends one combined notification instead.
  async function confirmPayment({ bookingId, paymentRef, paymentIntent, quiet = false }) {
    const outcome = await withTransaction(pool, async (client) => {
      const pre = (await client.query('SELECT seat_id FROM bookings WHERE id = $1', [bookingId])).rows[0];
      if (!pre) throw bookingNotFound();
      const seat = (
        await client.query('SELECT id, seat_key, status FROM seats WHERE id = $1 FOR UPDATE', [pre.seat_id])
      ).rows[0];
      const booking = (await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId])).rows[0];

      if (booking.status === 'confirmed' || booking.status === 'refund_required') {
        return { status: booking.status, booking, seat, changed: false };
      }

      let canSell = seat.status === 'available';
      if (canSell && booking.status !== 'held') {
        // Paid after the hold lapsed: sell only if nobody else holds the seat now.
        const other = await client.query(
          `SELECT 1 FROM bookings WHERE seat_id = $1 AND status = 'held' AND expires_at > now() AND id <> $2`,
          [seat.id, booking.id]
        );
        canSell = other.rowCount === 0;
        if (canSell) {
          await client.query(
            `UPDATE bookings SET status = 'expired', updated_at = now() WHERE seat_id = $1 AND status = 'held'`,
            [seat.id]
          );
        }
      }

      const status = canSell ? 'confirmed' : 'refund_required';
      if (canSell) await client.query(`UPDATE seats SET status = 'sold' WHERE id = $1`, [seat.id]);
      await client.query(
        `UPDATE bookings SET status = $2, payment_ref = COALESCE($3, payment_ref), updated_at = now() WHERE id = $1`,
        [booking.id, status, paymentRef ?? null]
      );
      return { status, booking, seat, changed: true };
    });

    const { booking, seat } = outcome;
    if (outcome.changed && outcome.status === 'confirmed') {
      await locks.release(booking.event_id, seat.seat_key, booking.session_id);
      bus.emit('seat', { eventId: booking.event_id, seatKey: seat.seat_key, status: 'sold' });
      bus.emit('activity', { eventId: booking.event_id, type: 'sold', seatKey: seat.seat_key });
    } else if (outcome.changed) {
      // Refund just this seat's amount: other seats in the order may be sold.
      await payments.refund(paymentIntent, booking.amount_minor);
    }
    if (outcome.changed && !quiet && outcome.status === 'confirmed') {
      bus.emit('notify', {
        sessionId: booking.session_id,
        kind: 'booking_confirmed',
        message: `Booking confirmed: seat ${seat.seat_key} is yours.`,
      });
      void mailer.send({
        to: booking.email,
        subject: `Your BookNow ticket: seat ${seat.seat_key}`,
        text: `Your booking is confirmed. Seat ${seat.seat_key}. Booking id ${booking.id}.`,
      });
    } else if (outcome.changed && !quiet) {
      bus.emit('notify', {
        sessionId: booking.session_id,
        kind: 'refund',
        message: `Seat ${seat.seat_key} was taken after your hold expired. Your payment will be refunded.`,
      });
      void mailer.send({
        to: booking.email,
        subject: `Refund for seat ${seat.seat_key}`,
        text: `Your hold expired before payment completed and the seat went to someone else. You will be refunded in full.`,
      });
    }
    return { bookingId, status: outcome.status, changed: outcome.changed };
  }

  async function joinWaitlist({ eventId, sessionId, email }) {
    const show = (await pool.query('SELECT (starts_at > now()) AS upcoming FROM events WHERE id = $1', [eventId])).rows[0];
    if (!show) throw new AppError(404, 'event_not_found', 'Show not found.');
    if (!show.upcoming) throw new AppError(409, 'show_started', 'This show has already started.');
    const free = await pool.query(
      `SELECT count(*)::int AS n FROM seats s
       WHERE s.event_id = $1 AND s.status = 'available'
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.seat_id = s.id AND b.status = 'held' AND b.expires_at > now())`,
      [eventId]
    );
    if (free.rows[0].n > 0) {
      throw new AppError(409, 'seats_available', 'Seats are still available. Pick one instead of joining the waitlist.');
    }
    await pool.query(
      `INSERT INTO waitlist (event_id, session_id, email) VALUES ($1, $2, $3)
       ON CONFLICT (event_id, session_id) WHERE status = 'waiting' DO UPDATE SET email = EXCLUDED.email`,
      [eventId, sessionId, email]
    );
    return waitlistPosition({ eventId, sessionId });
  }

  async function leaveWaitlist({ eventId, sessionId }) {
    await pool.query(
      `UPDATE waitlist SET status = 'left', updated_at = now() WHERE event_id = $1 AND session_id = $2 AND status = 'waiting'`,
      [eventId, sessionId]
    );
    return { joined: false };
  }

  async function waitlistPosition({ eventId, sessionId }) {
    const { rows } = await pool.query(
      `WITH queue AS (
         SELECT session_id, row_number() OVER (ORDER BY created_at, id)::int AS position
         FROM waitlist WHERE event_id = $1 AND status = 'waiting'
       )
       SELECT (SELECT count(*)::int FROM queue) AS length,
              (SELECT position FROM queue WHERE session_id = $2) AS position`,
      [eventId, sessionId ?? '']
    );
    const { length, position } = rows[0];
    return { joined: position !== null, position, length };
  }

  async function getEventState({ eventId, sessionId }) {
    await catalog.ensureSeats(eventId);
    // serverTime comes from Postgres, the clock that sets expires_at.
    const event = (
      await pool.query(
        'SELECT id, name, venue, starts_at, currency, (starts_at > now()) AS upcoming, now() AS db_now FROM events WHERE id = $1',
        [eventId]
      )
    ).rows[0];
    if (!event) throw new AppError(404, 'event_not_found', 'Event not found.');

    const { rows } = await pool.query(
      `SELECT s.seat_key, s.row_label, s.seat_number, s.tier, s.price_minor, s.status,
              b.id AS booking_id, b.session_id, b.expires_at, b.source
       FROM seats s
       LEFT JOIN bookings b ON b.seat_id = s.id AND b.status = 'held' AND b.expires_at > now()
       WHERE s.event_id = $1
       ORDER BY s.row_label, s.seat_number`,
      [eventId]
    );
    const seats = rows.map((r) => {
      const mine = Boolean(sessionId) && r.session_id === sessionId;
      return {
        seatKey: r.seat_key,
        row: r.row_label,
        number: r.seat_number,
        tier: r.tier,
        priceMinor: r.price_minor,
        status: r.status === 'sold' ? 'sold' : r.booking_id ? 'held' : 'available',
        heldByYou: mine,
      };
    });
    const yourHolds = rows
      .filter((r) => sessionId && r.session_id === sessionId)
      .map((r) => ({ id: r.booking_id, seatKey: r.seat_key, tier: r.tier, amountMinor: r.price_minor, expiresAt: r.expires_at, source: r.source }));

    const tickets = sessionId
      ? (
          await pool.query(
            `SELECT b.id, s.seat_key, s.tier, b.amount_minor, b.status, b.email
             FROM bookings b JOIN seats s ON s.id = b.seat_id
             WHERE b.event_id = $1 AND b.session_id = $2 AND b.status IN ('confirmed', 'refund_required')
             ORDER BY s.row_label, s.seat_number`,
            [eventId, sessionId]
          )
        ).rows.map((r) => ({ id: r.id, seatKey: r.seat_key, tier: r.tier, amountMinor: r.amount_minor, status: r.status, email: r.email }))
      : [];

    const counts = { total: seats.length, available: 0, held: 0, sold: 0 };
    for (const s of seats) counts[s.status] += 1;

    return {
      event: {
        id: event.id,
        name: event.name,
        venue: event.venue,
        startsAt: event.starts_at,
        currency: event.currency,
        upcoming: event.upcoming,
      },
      show: await catalog.showDetails(eventId),
      seats,
      counts,
      yourHolds,
      tickets,
      waitlist: await waitlistPosition({ eventId, sessionId }),
      limits: {
        holdSeconds: config.holdSeconds,
        waitlistHoldSeconds: config.waitlistHoldSeconds,
        maxHoldsPerSession: config.maxHoldsPerSession,
      },
      payments: payments.provider,
      serverTime: event.db_now.toISOString(),
    };
  }

  async function listEvents() {
    const { rows } = await pool.query(
      `SELECT e.id, e.name, e.venue, e.starts_at, e.currency,
              count(s.*)::int AS total, count(s.*) FILTER (WHERE s.status = 'available')::int AS unsold
       FROM events e LEFT JOIN seats s ON s.event_id = e.id
       WHERE e.movie_id IS NULL
       GROUP BY e.id ORDER BY e.starts_at`
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      venue: r.venue,
      startsAt: r.starts_at,
      currency: r.currency,
      totalSeats: r.total,
      unsoldSeats: r.unsold,
    }));
  }

  async function getBooking({ bookingId, sessionId }) {
    const row = (
      await pool.query(
        `SELECT b.id, b.event_id, b.session_id, b.status, b.amount_minor, b.email, b.expires_at, (b.expires_at > now()) AS active, now() AS db_now,
                s.seat_key, s.tier, e.name AS event_name, e.currency
         FROM bookings b JOIN seats s ON s.id = b.seat_id JOIN events e ON e.id = b.event_id
         WHERE b.id = $1`,
        [bookingId]
      )
    ).rows[0];
    if (!row || row.session_id !== sessionId) throw bookingNotFound();
    return {
      id: row.id,
      eventId: row.event_id,
      status: row.status === 'held' && !row.active ? 'expired' : row.status,
      seatKey: row.seat_key,
      tier: row.tier,
      amountMinor: row.amount_minor,
      currency: row.currency,
      email: row.email,
      eventName: row.event_name,
      expiresAt: row.expires_at,
      serverTime: row.db_now.toISOString(),
    };
  }

  async function completeMockPayment({ bookingId, sessionId }) {
    const row = (await pool.query('SELECT session_id, payment_ref FROM bookings WHERE id = $1', [bookingId])).rows[0];
    if (!row || row.session_id !== sessionId) throw bookingNotFound();
    if (!row.payment_ref) throw new AppError(409, 'checkout_not_started', 'Start checkout before paying.');
    return confirmPayment({ bookingId, paymentRef: row.payment_ref });
  }

  async function attendees(eventId) {
    const { rows } = await pool.query(
      `SELECT b.id, b.email, s.seat_key, s.tier, b.amount_minor, b.status, b.updated_at
       FROM bookings b JOIN seats s ON s.id = b.seat_id
       WHERE b.event_id = $1 AND b.status IN ('confirmed', 'refund_required') AND b.source <> 'seed'
       ORDER BY s.row_label, s.seat_number`,
      [eventId]
    );
    return rows;
  }

  // Invariants the load test and the admin page check after heavy traffic.
  async function integrity(eventId) {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*) FROM seats WHERE event_id = $1 AND status = 'sold')::int AS sold_seats,
         (SELECT count(*) FROM bookings WHERE event_id = $1 AND status = 'confirmed')::int AS confirmed_bookings,
         (SELECT count(*) FROM (
            SELECT seat_id FROM bookings WHERE event_id = $1 AND status = 'confirmed'
            GROUP BY seat_id HAVING count(*) > 1) d)::int AS seats_sold_twice,
         (SELECT count(*) FROM seats s WHERE s.event_id = $1 AND s.status = 'sold' AND NOT EXISTS (
            SELECT 1 FROM bookings b WHERE b.seat_id = s.id AND b.status = 'confirmed'))::int AS sold_without_booking,
         (SELECT count(*) FROM bookings WHERE event_id = $1 AND status = 'refund_required')::int AS refunds_required`,
      [eventId]
    );
    const r = rows[0];
    return {
      soldSeats: r.sold_seats,
      confirmedBookings: r.confirmed_bookings,
      seatsSoldTwice: r.seats_sold_twice,
      soldWithoutBooking: r.sold_without_booking,
      refundsRequired: r.refunds_required,
      ok: r.seats_sold_twice === 0 && r.sold_without_booking === 0 && r.sold_seats === r.confirmed_bookings,
    };
  }

  // Demo deployments refill the hall a few minutes after it sells out.
  async function resetIfSoldOut(eventId, idleMinutes) {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM seats WHERE event_id = $1 AND status = 'available')::int AS available,
              (SELECT max(updated_at) < now() - ($2::int * interval '1 minute')
                 FROM bookings WHERE event_id = $1 AND status = 'confirmed') AS idle`,
      [eventId, idleMinutes]
    );
    if (rows[0].available > 0 || !rows[0].idle) return false;
    await resetEvent(pool, eventId);
    bus.emit('reset', { eventId });
    bus.emit('activity', { eventId, type: 'reset' });
    return true;
  }

  async function resetSoldOutShows(idleMinutes) {
    const { rows } = await pool.query(
      `SELECT e.id FROM events e
       WHERE e.seats_ready AND e.starts_at > now()
         AND EXISTS (SELECT 1 FROM seats s WHERE s.event_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM seats s WHERE s.event_id = e.id AND s.status = 'available')`
    );
    let reset = 0;
    for (const { id } of rows) if (await resetIfSoldOut(id, idleMinutes)) reset += 1;
    return reset;
  }

  return {
    holdSeat,
    releaseHold,
    expireHolds,
    startCheckout,
    getOrder,
    payOrder,
    confirmOrder,
    myTickets,
    confirmPayment,
    completeMockPayment,
    joinWaitlist,
    leaveWaitlist,
    getEventState,
    listEvents,
    getBooking,
    attendees,
    integrity,
    resetIfSoldOut,
    resetSoldOutShows,
  };
}

module.exports = { createBookingService };
