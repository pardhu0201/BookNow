'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { withTransaction } = require('./db');

const MIGRATION_LOCK = 727274;

async function migrate(pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
  );
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await withTransaction(pool, async (client) => {
      // Two instances booting at once must not both apply the same file.
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (done.rowCount) return;
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    });
  }
}

module.exports = { migrate };
