'use strict';

const http = require('node:http');
const { EventEmitter } = require('node:events');
const { loadConfig } = require('./config');
const { createPool } = require('./db');
const { createRedis } = require('./redis');
const { migrate } = require('./migrate');
const { seed } = require('./seed');
const { createSessionAuth } = require('./auth');
const { createServices } = require('./services');
const { startSweeper } = require('./services/sweeper');
const { createApp } = require('./app');
const { attachRealtime } = require('./realtime');

async function waitFor(name, probe, attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      return await probe();
    } catch (err) {
      if (i >= attempts) throw new Error(`${name} unreachable: ${err.message}`);
      console.log(`[boot] waiting for ${name} (${i}/${attempts})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, config.dbPoolMax);
  const redis = createRedis(config.redisUrl);
  await waitFor('postgres', () => pool.query('SELECT 1'));
  await waitFor('redis', () => redis.ping());
  await migrate(pool);
  if (config.seedOnStartup && (await seed(pool))) console.log('[boot] seeded demo event');

  const bus = new EventEmitter();
  const auth = createSessionAuth(config.sessionSecret);
  const services = createServices({ config, pool, redis, bus });
  if (config.seedOnStartup) {
    await services.catalog.syncCatalog();
    console.log('[boot] catalogue synced (cities, theatres, movies, next 3 days of shows)');
  }
  const app = createApp({ config, services, auth, pool, redis });
  const server = http.createServer(app);
  const io = attachRealtime({ server, bus, auth, redis, config });
  const sweeper = startSweeper({ bookings: services.bookings, catalog: services.catalog, config });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[boot] BookNow on ${config.appUrl} (port ${config.port}, payments: ${services.payments.provider})`);
  });

  const shutdown = async (signal) => {
    console.log(`[boot] ${signal}: shutting down`);
    sweeper.stop();
    io.close();
    server.close();
    await pool.end().catch(() => {});
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
