'use strict';

const { DEMO_EVENT_ID } = require('../seed');

// Expires lapsed holds (freeing the seat and offering it to the waitlist).
// Every instance may run it: the UPDATE ... RETURNING claims each row once.
function startSweeper({ bookings, config }) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      await bookings.expireHolds();
      if (config.demoMode) await bookings.resetIfSoldOut(DEMO_EVENT_ID, config.demoResetMinutes);
    } catch (err) {
      console.error('[sweeper]', err.message);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, config.sweepIntervalMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { startSweeper };
