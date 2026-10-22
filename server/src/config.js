'use strict';

const path = require('node:path');

const DEV_SECRET = 'dev-only-insecure-secret';

// Empty strings count as unset: Render passes blank values for optional keys.
function opt(value) {
  return value === undefined || value === '' ? undefined : value;
}

function loadConfig(env = process.env) {
  const port = Number(env.PORT || 4000);
  const stripeSecretKey = opt(env.STRIPE_SECRET_KEY);

  const config = {
    env: env.NODE_ENV || 'development',
    port,
    databaseUrl: opt(env.DATABASE_URL) || 'postgres://booknow:booknow@localhost:5432/booknow',
    dbPoolMax: Number(env.DB_POOL_MAX || 15),
    redisUrl: opt(env.REDIS_URL) || 'redis://localhost:6379',
    appUrl: (opt(env.APP_URL) || opt(env.RENDER_EXTERNAL_URL) || `http://localhost:${port}`).replace(/\/+$/, ''),
    sessionSecret: opt(env.SESSION_SECRET) || DEV_SECRET,
    holdSeconds: Number(env.HOLD_SECONDS || 600),
    waitlistHoldSeconds: Number(env.WAITLIST_HOLD_SECONDS || 300),
    maxHoldsPerSession: Number(env.MAX_HOLDS_PER_SESSION || 4),
    sweepIntervalMs: Number(env.SWEEP_INTERVAL_MS || 5000),
    payments: {
      provider: stripeSecretKey ? 'stripe' : 'mock',
      stripeSecretKey,
      stripeWebhookSecret: opt(env.STRIPE_WEBHOOK_SECRET),
      currency: 'inr',
    },
    adminToken: opt(env.ADMIN_TOKEN),
    smtp: {
      host: opt(env.SMTP_HOST),
      port: Number(env.SMTP_PORT || 587),
      user: opt(env.SMTP_USER),
      pass: opt(env.SMTP_PASS),
      from: opt(env.MAIL_FROM) || 'BookNow <no-reply@booknow.local>',
    },
    demoMode: env.DEMO_MODE === 'true',
    demoResetMinutes: Number(env.DEMO_RESET_MINUTES || 3),
    seedOnStartup: env.SEED_ON_STARTUP !== 'false',
    rateLimit: env.RATE_LIMIT !== 'off',
    clientDist: opt(env.CLIENT_DIST) || path.resolve(__dirname, '../../client/dist'),
  };

  if (config.env === 'production' && config.sessionSecret === DEV_SECRET) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  return config;
}

module.exports = { loadConfig };
