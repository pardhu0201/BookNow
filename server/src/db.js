'use strict';

const { Pool } = require('pg');

function createPool(databaseUrl, max = 15) {
  const pool = new Pool({ connectionString: databaseUrl, max });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  return pool;
}

// Runs fn inside BEGIN/COMMIT on one connection; rolls back on any error.
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
