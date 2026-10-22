'use strict';

const { createSeatLocks } = require('./locks');
const { createPayments } = require('./payments');
const { createMailer } = require('./mailer');
const { createBookingService } = require('./bookings');

function createServices({ config, pool, redis, bus }) {
  const locks = createSeatLocks(redis);
  const payments = createPayments(config.payments, config.appUrl);
  const mailer = createMailer(config.smtp);
  const bookings = createBookingService({ pool, locks, payments, mailer, bus, config });
  return { locks, payments, mailer, bookings };
}

module.exports = { createServices };
