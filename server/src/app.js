'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { AppError } = require('./errors');
const v = require('./validate');
const { toCsv } = require('./csv');

function createApp({ config, services, auth, pool, redis }) {
  const { bookings, payments } = services;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'connect-src': ["'self'", config.appUrl.replace(/^http/, 'ws')],
          'img-src': ["'self'", 'data:'],
          'upgrade-insecure-requests': config.env === 'production' ? [] : null,
        },
      },
    })
  );

  // Raw body for Stripe signature checks. It must be registered before the
  // JSON parser: the old app parsed JSON first, so every signature check failed.
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    let event;
    try {
      event = payments.parseWebhook(req.body, req.get('stripe-signature'));
    } catch (err) {
      if (err instanceof AppError) throw err;
      return res.status(400).json({ error: { code: 'bad_signature', message: 'Webhook signature verification failed.' } });
    }
    const types = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
    const session = event.data.object;
    if (types.includes(event.type) && session.payment_status === 'paid' && session.metadata?.bookingId) {
      try {
        await bookings.confirmPayment({
          bookingId: v.uuid(session.metadata.bookingId, 'bookingId'),
          paymentRef: session.id,
          paymentIntent: session.payment_intent,
        });
      } catch (err) {
        // Unknown booking: acknowledge so Stripe stops retrying, but log it.
        if (!(err instanceof AppError)) throw err;
        console.warn('[webhook] ignored', event.id, err.code);
      }
    }
    res.json({ received: true });
  });

  app.use(express.json({ limit: '20kb' }));

  if (config.rateLimit) {
    app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
  }
  const holdLimiter = config.rateLimit
    ? rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false })
    : (req, res, next) => next();

  const readSession = (req) => auth.verify((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const requireSession = (req, res, next) => {
    req.sessionId = readSession(req);
    if (!req.sessionId) throw new AppError(401, 'no_session', 'Missing or invalid session token.');
    next();
  };
  const optionalSession = (req, res, next) => {
    req.sessionId = readSession(req);
    next();
  };
  const requireAdmin = (req, res, next) => {
    if (!config.adminToken) throw new AppError(404, 'not_found', 'Not found.');
    const given = Buffer.from(req.get('x-admin-token') || '');
    const expected = Buffer.from(config.adminToken);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      throw new AppError(401, 'unauthorized', 'Admin token required.');
    }
    next();
  };

  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ ok: true, payments: payments.provider, demoMode: config.demoMode });
  });

  app.post('/api/session', (req, res) => {
    res.status(201).json({ token: auth.issue().token });
  });

  app.get('/api/events', async (req, res) => {
    res.json({ events: await bookings.listEvents() });
  });

  app.get('/api/events/:eventId', optionalSession, async (req, res) => {
    res.json(await bookings.getEventState({ eventId: v.uuid(req.params.eventId, 'eventId'), sessionId: req.sessionId }));
  });

  app.post('/api/events/:eventId/holds', requireSession, holdLimiter, async (req, res) => {
    const hold = await bookings.holdSeat({
      eventId: v.uuid(req.params.eventId, 'eventId'),
      seatKey: v.seatKey(req.body?.seatKey),
      sessionId: req.sessionId,
    });
    res.status(201).json(hold);
  });

  app.delete('/api/holds/:bookingId', requireSession, async (req, res) => {
    res.json(await bookings.releaseHold({ bookingId: v.uuid(req.params.bookingId, 'bookingId'), sessionId: req.sessionId }));
  });

  app.post('/api/holds/:bookingId/checkout', requireSession, async (req, res) => {
    res.json(
      await bookings.startCheckout({
        bookingId: v.uuid(req.params.bookingId, 'bookingId'),
        sessionId: req.sessionId,
        email: v.email(req.body?.email),
      })
    );
  });

  app.get('/api/bookings/:bookingId', requireSession, async (req, res) => {
    res.json(await bookings.getBooking({ bookingId: v.uuid(req.params.bookingId, 'bookingId'), sessionId: req.sessionId }));
  });

  app.post('/api/events/:eventId/waitlist', requireSession, async (req, res) => {
    const result = await bookings.joinWaitlist({
      eventId: v.uuid(req.params.eventId, 'eventId'),
      sessionId: req.sessionId,
      email: v.email(req.body?.email),
    });
    res.status(201).json(result);
  });

  app.delete('/api/events/:eventId/waitlist', requireSession, async (req, res) => {
    res.json(await bookings.leaveWaitlist({ eventId: v.uuid(req.params.eventId, 'eventId'), sessionId: req.sessionId }));
  });

  app.post('/api/payments/mock/:bookingId', requireSession, async (req, res) => {
    if (payments.provider !== 'mock') throw new AppError(404, 'not_found', 'Mock payments are disabled.');
    res.json(
      await bookings.completeMockPayment({ bookingId: v.uuid(req.params.bookingId, 'bookingId'), sessionId: req.sessionId })
    );
  });

  // Was public before; it leaked every attendee's email.
  app.get('/api/admin/events/:eventId/attendees.csv', requireAdmin, async (req, res) => {
    const rows = await bookings.attendees(v.uuid(req.params.eventId, 'eventId'));
    res.type('text/csv').attachment('attendees.csv');
    res.send(
      toCsv(
        ['booking_id', 'email', 'seat', 'tier', 'amount_minor', 'status', 'updated_at'],
        rows.map((r) => [r.id, r.email, r.seat_key, r.tier, r.amount_minor, r.status, r.updated_at.toISOString()])
      )
    );
  });

  app.get('/api/admin/events/:eventId/integrity', requireAdmin, async (req, res) => {
    res.json(await bookings.integrity(v.uuid(req.params.eventId, 'eventId')));
  });

  app.use('/api', () => {
    throw new AppError(404, 'not_found', 'No such API route.');
  });

  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(indexHtml) : next()));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON.' } });
    }
    console.error('[api]', req.method, req.path, err);
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
  });

  return app;
}

module.exports = { createApp };
