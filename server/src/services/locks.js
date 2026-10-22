'use strict';

// Compare-and-delete: only the owner can release a lock.
const RELEASE_IF_OWNER = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

function createSeatLocks(redis) {
  redis.defineCommand('releaseIfOwner', { numberOfKeys: 1, lua: RELEASE_IF_OWNER });
  const key = (eventId, seatKey) => `booknow:lock:${eventId}:${seatKey}`;

  return {
    key,
    async acquire(eventId, seatKey, owner, ttlSeconds) {
      return (await redis.set(key(eventId, seatKey), owner, 'EX', ttlSeconds, 'NX')) === 'OK';
    },
    async release(eventId, seatKey, owner) {
      return (await redis.releaseIfOwner(key(eventId, seatKey), owner)) === 1;
    },
    owner(eventId, seatKey) {
      return redis.get(key(eventId, seatKey));
    },
  };
}

module.exports = { createSeatLocks };
