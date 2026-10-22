'use strict';

const CATALOG_SYNC_MS = 60 * 60 * 1000;

// Expires lapsed holds (freeing the seat and offering it to the waitlist).
// Every instance may run it: the UPDATE ... RETURNING claims each row once.
// Also rolls the showtime window forward every hour.
function startSweeper({ bookings, catalog, config }) {
  let running = false;
  let lastSync = Date.now();

  async function tick() {
    if (running) return;
    running = true;
    try {
      await bookings.expireHolds();
      if (config.demoMode) await bookings.resetSoldOutShows(config.demoResetMinutes);
      if (catalog && Date.now() - lastSync > CATALOG_SYNC_MS) {
        lastSync = Date.now();
        await catalog.syncCatalog();
      }
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
