'use strict';

const { createSeatLocks } = require('./locks');
const { createPayments } = require('./payments');
const { createMailer } = require('./mailer');
const { createBookingService } = require('./bookings');
const { createCatalogService } = require('./catalog');

function createServices({ config, pool, redis, bus }) {
  const locks = createSeatLocks(redis);
  const payments = createPayments(config.payments, config.appUrl);
  const mailer = createMailer(config.smtp);
  const catalog = createCatalogService({ pool });
  const bookings = createBookingService({ pool, locks, payments, mailer, bus, config, catalog });
  return { locks, payments, mailer, catalog, bookings };
}

module.exports = { createServices };
