const redis = require('../redisClient');

const makeLockKey = (eventId, seatKey) => `lock:event:${eventId}:seat:${seatKey}`;

async function acquireSeatLock(eventId, seatKey, userId, ttlSeconds = 600) {
  const key = makeLockKey(eventId, seatKey);
  const res = await redis.set(key, userId, 'NX', 'EX', ttlSeconds);
  return res === 'OK';
}

async function releaseSeatLock(eventId, seatKey, userId) {
  const key = makeLockKey(eventId, seatKey);
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  return await redis.eval(script, 1, key, userId);
}

async function getLockOwner(eventId, seatKey) {
  return await redis.get(makeLockKey(eventId, seatKey));
}

module.exports = { acquireSeatLock, releaseSeatLock, getLockOwner };
