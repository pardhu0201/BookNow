import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  vus: 120,
  duration: '60s',
  thresholds: {
    'http_req_failed': ['rate<0.01']
  }
};

const API = 'http://localhost:4000';

export default function () {
  // pick a random seat from a small set to create contention
  const eventId = '00000000-0000-0000-0000-000000000001';
  const seatIndex = Math.floor(Math.random() * 50);
  const seatKey = `R${Math.floor(seatIndex/10)+1}C${seatIndex%10+1}`;
  const payload = JSON.stringify({ eventId, seatKey, userId: `loadtest-${__VU}-${__ITER}`, userEmail: `user+${__VU}@load.test` });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const res = http.post(`${API}/api/lock`, payload, params);
  check(res, { 'status is 200 or 409': (r) => r.status === 200 || r.status === 409 });
  sleep(Math.random() * 1.5);
}
