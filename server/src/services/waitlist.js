const redis = require('../redisClient');
const WAITLIST_KEY = (eventId) => `waitlist:event:${eventId}`;

async function pushToWaitlist(eventId, userEmail) {
  await redis.rpush(WAITLIST_KEY(eventId), userEmail);
}

async function popFromWaitlist(eventId) {
  return await redis.lpop(WAITLIST_KEY(eventId));
}

async function peekWaitlist(eventId, count = 10) {
  return await redis.lrange(WAITLIST_KEY(eventId), 0, count - 1);
}

module.exports = { pushToWaitlist, popFromWaitlist, peekWaitlist };
