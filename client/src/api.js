const TOKEN_KEY = 'booknow.session';
const EMAIL_KEY = 'booknow.email';

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* private mode: fine, the session just will not survive a reload */
    }
  },
};

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let tokenPromise = null;

// Guest session issued by the server; it identifies whose holds are whose.
export function getToken() {
  if (!tokenPromise) {
    tokenPromise = (async () => {
      const saved = storage.get(TOKEN_KEY);
      if (saved) return saved;
      const res = await fetch('/api/session', { method: 'POST' });
      if (!res.ok) throw new ApiError(res.status, 'session_failed', 'Could not start a session. Please reload.');
      const { token } = await res.json();
      storage.set(TOKEN_KEY, token);
      return token;
    })();
    tokenPromise.catch(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

export async function api(path, { method = 'GET', body, retried = false } = {}) {
  const token = await getToken();
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) {
    // The server's secret changed (e.g. a redeploy): start a fresh session.
    storage.set(TOKEN_KEY, null);
    tokenPromise = null;
    return api(path, { method, body, retried: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code, data?.error?.message || `Request failed (${res.status}).`);
  }
  return data;
}

export const savedEmail = () => storage.get(EMAIL_KEY) || '';
export const saveEmail = (email) => storage.set(EMAIL_KEY, email);
export const savedCity = () => storage.get('booknow.city') || '';
export const saveCity = (slug) => storage.set('booknow.city', slug);

// Public reads (catalogue) need no session.
export async function getJson(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code, data?.error?.message || `Request failed (${res.status}).`);
  return data;
}

const IST = 'Asia/Kolkata';
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: IST });
const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST });
export const formatTime = (iso) => timeFmt.format(new Date(iso));
export const formatDay = (iso) => dayFmt.format(new Date(iso));

// "2026-10-22" -> "Today" / "Tomorrow" / "Sat, 24 Oct", in IST.
export function dayLabel(ymd) {
  const todayIst = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const tomorrowIst = new Date(Date.now() + 29.5 * 3600 * 1000).toISOString().slice(0, 10);
  if (ymd === todayIst) return 'Today';
  if (ymd === tomorrowIst) return 'Tomorrow';
  return dayFmt.format(new Date(`${ymd}T12:00:00+05:30`));
}

export function runtimeLabel(minutes) {
  if (!minutes) return null;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const formatters = new Map();
export function formatPrice(minor, currency = 'INR') {
  if (!formatters.has(currency)) {
    formatters.set(currency, new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }));
  }
  return formatters.get(currency).format(minor / 100);
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
