'use strict';

const crypto = require('node:crypto');

// Guest sessions: the server issues "<id>.<hmac>", so a client cannot claim
// another visitor's id (the old API trusted any userId sent in the body).
function createSessionAuth(secret) {
  const sign = (id) => crypto.createHmac('sha256', secret).update(id).digest('base64url');

  return {
    issue() {
      const sessionId = crypto.randomBytes(16).toString('base64url');
      return { sessionId, token: `${sessionId}.${sign(sessionId)}` };
    },
    verify(token) {
      if (typeof token !== 'string') return null;
      const [id, sig] = token.split('.');
      if (!id || !sig) return null;
      const given = Buffer.from(sig);
      const expected = Buffer.from(sign(id));
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
      return id;
    },
  };
}

module.exports = { createSessionAuth };
