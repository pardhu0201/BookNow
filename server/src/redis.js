'use strict';

const Redis = require('ioredis');

function createRedis(url) {
  const client = new Redis(url, { maxRetriesPerRequest: 2 });
  client.on('error', (err) => console.error('[redis]', err.message));
  return client;
}

module.exports = { createRedis };
