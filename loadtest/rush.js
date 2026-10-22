// k6 load test: 120 virtual users rush 50 seats. Each one repeatedly grabs a
// random seat; winners pay (or sometimes release), losers get 409. Teardown
// asks the server to audit its books: no seat may be sold twice.
//
//   RATE_LIMIT=off node server/src/index.js      (rate limits off for one IP)
//   k6 run loadtest/rush.js
//   k6 run -e BASE_URL=https://your-app -e ADMIN_TOKEN=... loadtest/rush.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || 'local-admin-token';
const EVENT = '00000000-0000-0000-0000-000000000001';
const SEATS = 'ABCDE'.split('').flatMap((row) => Array.from({ length: 10 }, (_, i) => `${row}${i + 1}`));

const holdsWon = new Counter('holds_won');
const holdsRejected = new Counter('holds_rejected');
const seatsSold = new Counter('seats_sold');

// 409 "someone else has it" is the correct answer under contention, not a failure.
http.setResponseCallback(http.expectedStatuses(200, 201, 409));

export const options = {
  scenarios: {
    rush: { executor: 'per-vu-iterations', vus: 120, iterations: 5, maxDuration: '2m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:hold}': ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

let token = null;

export default function () {
  if (!token) token = http.post(`${BASE}/api/session`, null, { tags: { name: 'session' } }).json('token');
  const params = (name) => ({
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    tags: { name },
  });

  const seatKey = SEATS[Math.floor(Math.random() * SEATS.length)];
  const hold = http.post(`${BASE}/api/events/${EVENT}/holds`, JSON.stringify({ seatKey }), params('hold'));
  check(hold, { 'hold answered 201 or 409': (r) => r.status === 201 || r.status === 409 });
  if (hold.status !== 201) {
    holdsRejected.add(1);
    return;
  }
  holdsWon.add(1);
  const id = hold.json('id');

  if (Math.random() < 0.3) {
    const released = http.del(`${BASE}/api/holds/${id}`, null, params('release'));
    check(released, { 'release ok': (r) => r.status === 200 });
    return;
  }
  const checkout = http.post(`${BASE}/api/holds/${id}/checkout`, JSON.stringify({ email: `vu${__VU}@load.test` }), params('checkout'));
  check(checkout, { 'checkout ok': (r) => r.status === 200 });
  const paid = http.post(`${BASE}/api/payments/mock/${id}`, null, params('pay'));
  check(paid, { 'payment ok': (r) => r.status === 200 });
  if (paid.status === 200 && paid.json('status') === 'confirmed') seatsSold.add(1);
}

export function teardown() {
  const res = http.get(`${BASE}/api/admin/events/${EVENT}/integrity`, { headers: { 'x-admin-token': ADMIN_TOKEN } });
  const report = res.json();
  console.log(`integrity: ${JSON.stringify(report)}`);
  check(report, {
    'no seat sold twice': (r) => r.seatsSoldTwice === 0,
    'sold seats equal confirmed bookings': (r) => r.ok === true,
  });
}
