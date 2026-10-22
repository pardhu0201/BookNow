import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken, formatPrice } from './api.js';
import SeatMap from './components/SeatMap.jsx';
import HoldPanel from './components/HoldPanel.jsx';
import WaitlistCard from './components/WaitlistCard.jsx';
import ActivityFeed from './components/ActivityFeed.jsx';
import Toasts, { useToasts } from './components/Toasts.jsx';

// Read once at load: Stripe and the mock checkout return here with these.
const returnParams = new URLSearchParams(window.location.search);

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

function usePaymentReturn() {
  const [banner, setBanner] = useState(null);
  useEffect(() => {
    const payment = returnParams.get('payment');
    const bookingId = returnParams.get('booking');
    if (!payment || !bookingId) return undefined;
    window.history.replaceState(null, '', '/');
    if (payment === 'cancelled') {
      setBanner({ kind: 'info', text: 'Payment cancelled. Your hold stays active until its timer runs out.' });
      return undefined;
    }
    let stopped = false;
    let tries = 0;
    setBanner({ kind: 'pending', text: 'Confirming your payment…' });
    const poll = async () => {
      if (stopped) return;
      try {
        const b = await api(`/api/bookings/${bookingId}`);
        if (b.status === 'confirmed') {
          setBanner({
            kind: 'success',
            text: `You're in! Seat ${b.seatKey} is confirmed${b.email ? `, and the ticket goes to ${b.email}` : ''}.`,
          });
          return;
        }
        if (b.status === 'refund_required') {
          setBanner({ kind: 'warn', text: `Seat ${b.seatKey} went to someone else after your hold expired. You will be refunded.` });
          return;
        }
      } catch {
        /* keep polling: the webhook may not have landed yet */
      }
      tries += 1;
      if (tries < 20) setTimeout(poll, 1500);
      else setBanner({ kind: 'warn', text: 'Still waiting for the payment provider. Refresh in a moment.' });
    };
    poll();
    return () => {
      stopped = true;
    };
  }, []);
  return [banner, setBanner];
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export default function EventPage() {
  const [eventId, setEventId] = useState(null);
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [viewers, setViewers] = useState(null);
  const [activity, setActivity] = useState([]);
  const [busySeat, setBusySeat] = useState(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [banner, setBanner] = usePaymentReturn();
  const { toasts, push, dismiss } = useToasts();
  const refreshTimer = useRef(null);

  const load = useCallback(async (id) => {
    const data = await api(`/api/events/${id}`);
    setClockOffset(Date.parse(data.serverTime) - Date.now());
    setState(data);
  }, []);

  // Seat events arrive in bursts during a rush; coalesce them into one fetch.
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      if (eventId) load(eventId).catch(() => {});
    }, 120);
  }, [eventId, load]);

  useEffect(() => {
    api('/api/events')
      .then(({ events }) => {
        if (!events.length) throw new Error('No events are on sale yet.');
        setEventId(events[0].id);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    if (eventId) load(eventId).catch((err) => setLoadError(err.message));
  }, [eventId, load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!eventId) return undefined;
    let socket;
    let cancelled = false;
    getToken().then((token) => {
      if (cancelled) return;
      socket = io({ auth: { token } });
      socket.on('connect', () => {
        setConnected(true);
        socket.emit('event:join', eventId);
        scheduleRefresh();
      });
      socket.on('disconnect', () => setConnected(false));
      socket.on('seat', scheduleRefresh);
      socket.on('presence', (p) => p.eventId === eventId && setViewers(p.viewers));
      socket.on('activity', (a) => setActivity((prev) => [{ ...a, key: `${a.at}-${a.type}-${a.seatKey}-${Math.random()}` }, ...prev].slice(0, 12)));
      socket.on('notify', (n) => {
        push(n.message, n.kind === 'hold_expired' || n.kind === 'refund' ? 'warn' : 'success');
        scheduleRefresh();
      });
      socket.on('reset', () => {
        push('The demo hall was refilled. Every seat is up for grabs again.', 'info');
        scheduleRefresh();
      });
    });
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [eventId, scheduleRefresh, push]);

  const holdSeat = async (seatKey) => {
    setBusySeat(seatKey);
    try {
      await api(`/api/events/${eventId}/holds`, { method: 'POST', body: { seatKey } });
      push(`Seat ${seatKey} is held for you for ${Math.round(state.limits.holdSeconds / 60)} minutes.`, 'success');
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusySeat(null);
      await load(eventId).catch(() => {});
    }
  };

  const release = async (bookingId) => {
    try {
      await api(`/api/holds/${bookingId}`, { method: 'DELETE' });
    } catch (err) {
      push(err.message, 'error');
    }
    await load(eventId).catch(() => {});
  };

  // Navigates away to the payment page on success.
  const checkout = async (bookingId, email) => {
    try {
      const { url } = await api(`/api/holds/${bookingId}/checkout`, { method: 'POST', body: { email } });
      window.location.assign(url);
    } catch (err) {
      push(err.message, 'error');
      await load(eventId).catch(() => {});
      throw err;
    }
  };

  const joinWaitlist = async (email) => {
    try {
      await api(`/api/events/${eventId}/waitlist`, { method: 'POST', body: { email } });
      push("You're on the waitlist. We'll hold the next free seat for you.", 'success');
    } catch (err) {
      push(err.message, 'error');
    }
    await load(eventId).catch(() => {});
  };

  const leaveWaitlist = async () => {
    await api(`/api/events/${eventId}/waitlist`, { method: 'DELETE' }).catch((err) => push(err.message, 'error'));
    await load(eventId).catch(() => {});
  };

  if (loadError) {
    return (
      <div className="center-page">
        <div className="card notice">
          <h1>BookNow is waking up</h1>
          <p>{loadError}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="center-page">
        <div className="spinner" aria-label="Loading seats" />
        <p className="muted">Loading seats… the free server may take up to a minute to wake.</p>
      </div>
    );
  }

  const { event, seats, counts, yourHolds, tickets, waitlist, limits, payments } = state;
  const serverNow = now + clockOffset;
  const prices = [...new Map(seats.map((s) => [s.tier, s.priceMinor])).entries()];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">B</span>
          BookNow
        </div>
        <div className={`live ${connected ? 'on' : ''}`} role="status">
          <span className="dot" aria-hidden="true" />
          {connected ? `${viewers ?? 1} viewing now` : 'Reconnecting…'}
        </div>
      </header>

      {banner && (
        <div className={`banner banner-${banner.kind}`} role="status">
          <span>{banner.text}</span>
          <button className="icon-btn" onClick={() => setBanner(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <main className="layout">
        <section className="card hall" aria-labelledby="event-title">
          <div className="event-head">
            <div>
              <p className="eyebrow">{dateFormat.format(new Date(event.startsAt))} IST</p>
              <h1 id="event-title">{event.name}</h1>
              <p className="muted">{event.venue}</p>
            </div>
            <div className="stats">
              <Stat label="Available" value={counts.available} tone="available" />
              <Stat label="On hold" value={counts.held} tone="held" />
              <Stat label="Sold" value={counts.sold} tone="sold" />
            </div>
          </div>

          <SeatMap seats={seats} busySeat={busySeat} onPick={holdSeat} currency={event.currency} />

          <div className="legend">
            <div className="legend-group">
              <span className="key key-available" /> Available
              <span className="key key-mine" /> Your hold
              <span className="key key-held" /> Held by someone
              <span className="key key-sold" /> Sold
            </div>
            <div className="legend-group">
              {prices.map(([tier, price]) => (
                <span key={tier} className={`tier-chip tier-${tier.toLowerCase()}`}>
                  {tier} {formatPrice(price, event.currency)}
                </span>
              ))}
            </div>
          </div>
        </section>

        <aside className="sidebar">
          <HoldPanel
            holds={yourHolds}
            tickets={tickets}
            serverNow={serverNow}
            currency={event.currency}
            limits={limits}
            payments={payments}
            onRelease={release}
            onCheckout={checkout}
          />
          {(counts.available === 0 || waitlist.joined) && (
            <WaitlistCard
              waitlist={waitlist}
              minutes={Math.round(limits.waitlistHoldSeconds / 60)}
              onJoin={joinWaitlist}
              onLeave={leaveWaitlist}
            />
          )}
          <ActivityFeed items={activity} serverNow={serverNow} />
          <div className="card tip">
            <strong>Try it with a friend.</strong> Open this page in two browser windows and hold a seat in one: it
            locks in the other instantly. Nobody can buy a seat you are holding.
          </div>
        </aside>
      </main>

      <footer className="footer">
        Built with React, Node.js, PostgreSQL, Redis and Socket.IO ·{' '}
        <a href="https://github.com/pardhu0201/BookNow" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
