'use strict';

const http = require('node:http');
const { EventEmitter } = require('node:events');
const request = require('supertest');
const { loadConfig } = require('../src/config');
const { createPool } = require('../src/db');
const { createRedis } = require('../src/redis');
const { migrate } = require('../src/migrate');
const { seed, DEMO_EVENT_ID } = require('../src/seed');
const { createSessionAuth } = require('../src/auth');
const { createServices } = require('../src/services');
const { createApp } = require('../src/app');

const TEST_ENV = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://booknow:booknow@localhost:5432/booknow_test',
  REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379/1',
  RATE_LIMIT: 'off',
  ADMIN_TOKEN: 'test-admin-token',
  STRIPE_SECRET_KEY: '',
  SMTP_HOST: '',
};

// A fresh app on a clean database for each test file (or each test).
async function setup(overrides = {}) {
  const base = loadConfig(TEST_ENV);
  const config = { ...base, ...overrides, payments: { ...base.payments, ...overrides.payments } };
  const pool = createPool(config.databaseUrl);
  const redis = createRedis(config.redisUrl);
  await migrate(pool);

  const bus = new EventEmitter();
  const events = [];
  async function reset() {
    await pool.query('TRUNCATE waitlist, bookings, seats, events CASCADE');
    await redis.flushdb();
    await seed(pool);
    events.length = 0;
  }
  await reset();

  for (const name of ['seat', 'activity', 'notify', 'reset']) bus.on(name, (e) => events.push({ name, ...e }));
  const auth = createSessionAuth(config.sessionSecret);
  const services = createServices({ config, pool, redis, bus });
  const app = createApp({ config, services, auth, pool, redis });
  const server = http.createServer(app).listen(0);
  const api = request(server);

  return {
    config,
    pool,
    redis,
    bus,
    events,
    auth,
    services,
    api,
    reset,
    eventId: DEMO_EVENT_ID,
    async session() {
      const res = await api.post('/api/session').expect(201);
      const token = res.body.token;
      return { token, id: auth.verify(token), header: { Authorization: `Bearer ${token}` } };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
      redis.disconnect();
    },
  };
}

// Moves a hold's expiry into the past, as if its time ran out.
async function expireBooking(pool, bookingId) {
  await pool.query(`UPDATE bookings SET expires_at = now() - interval '1 second' WHERE id = $1`, [bookingId]);
}

module.exports = { setup, expireBooking };
