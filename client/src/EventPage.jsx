import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken, formatPrice, runtimeLabel } from './api.js';
import { Link } from './router.jsx';
import SeatMap from './components/SeatMap.jsx';
import OrderSummary from './components/OrderSummary.jsx';
import WaitlistCard from './components/WaitlistCard.jsx';
import ActivityFeed from './components/ActivityFeed.jsx';
import Toasts, { useToasts } from './components/Toasts.jsx';
import { Page, Poster, Spinner, EmptyState } from './components/Chrome.jsx';
import { ArrowLeftIcon, CloseIcon } from './components/icons.jsx';

const IST = 'Asia/Kolkata';
const whenFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: IST });
const istDate = (iso) => new Date(Date.parse(iso) + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// Stripe and the test checkout come back here with ?payment=...&order=...
// Read from the URL when this page mounts (not once per page load), so the
// banner never reappears on a later show.
function usePaymentReturn() {
  const [banner, setBanner] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const order = params.get('order');
    if (!payment || !order) return undefined;
    const clear = () => window.history.replaceState(null, '', window.location.pathname);
    if (payment === 'cancelled') {
      clear();
      setBanner({ kind: 'info', text: 'Payment cancelled. Your seats stay held until the timer runs out.' });
      return undefined;
    }
    let stopped = false;
    let tries = 0;
    setBanner({ kind: 'pending', text: 'Confirming your payment…' });
    const poll = async () => {
      if (stopped) return;
      try {
        const o = await api(`/api/orders/${encodeURIComponent(order)}`);
        const seats = o.seats.filter((s) => s.status === 'confirmed').map((s) => s.seatKey).join(', ');
        if (o.status === 'confirmed' || o.status === 'partial') {
          clear();
          setBanner({
            kind: 'success',
            text: `You're in! ${seats} confirmed${o.email ? `. Tickets sent to ${o.email}` : ''}.`,
            link: true,
          });
          return;
        }
        if (o.status === 'refund_required') {
          clear();
          setBanner({ kind: 'warn', text: 'Your seats went to someone else after your hold expired. You will be refunded.' });
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

function ShowBar({ event, show, counts }) {
  const when = `${whenFormat.format(new Date(event.startsAt))} IST`;
  return (
    <section className="show-bar card">
      {show && <Poster movie={show.movie} className="show-bar-poster" />}
      <div className="show-bar-text">
        <h1 id="event-title">{show ? show.movie.title : event.name}</h1>
        <p className="show-bar-meta">
          {show
            ? [show.movie.language, show.movie.certification, runtimeLabel(show.movie.runtimeMinutes)].filter(Boolean).join(' · ')
            : event.venue}
        </p>
        <p className="show-bar-where">
          {show && (
            <>
              <strong>{show.theatre.name}</strong>, {show.theatre.area} · {show.screen} ·{' '}
            </>
          )}
          <span>{when}</span>
        </p>
      </div>
      <dl className="show-stats">
        <div>
          <dt>Available</dt>
          <dd className="tone-available">{counts.available}</dd>
        </div>
        <div>
          <dt>On hold</dt>
          <dd className="tone-held">{counts.held}</dd>
        </div>
        <div>
          <dt>Sold</dt>
          <dd>{counts.sold}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function EventPage({ showId }) {
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

  const load = useCallback(async () => {
    const data = await api(`/api/events/${showId}`);
    setClockOffset(Date.parse(data.serverTime) - Date.now());
    setState(data);
  }, [showId]);

  // Seat events arrive in bursts during a rush; coalesce them into one fetch.
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => load().catch(() => {}), 120);
  }, [load]);

  useEffect(() => {
    load().catch((err) => setLoadError(err.message));
    return () => clearTimeout(refreshTimer.current);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let socket;
    let cancelled = false;
    getToken().then((token) => {
      if (cancelled) return;
      socket = io({ auth: { token } });
      socket.on('connect', () => {
        setConnected(true);
        socket.emit('event:join', showId);
        scheduleRefresh();
      });
      socket.on('disconnect', () => setConnected(false));
      socket.on('seat', scheduleRefresh);
      socket.on('presence', (p) => p.eventId === showId && setViewers(p.viewers));
      socket.on('activity', (a) => setActivity((prev) => [{ ...a, key: `${a.at}-${a.type}-${a.seatKey}-${Math.random()}` }, ...prev].slice(0, 8)));
      socket.on('notify', (n) => {
        push(n.message, n.kind === 'hold_expired' || n.kind === 'refund' ? 'warn' : 'success');
        scheduleRefresh();
      });
      socket.on('reset', () => {
        push('This show was refilled for the demo. Every seat is up for grabs again.', 'info');
        scheduleRefresh();
      });
    });
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [showId, scheduleRefresh, push]);

  const holdSeat = async (seatKey) => {
    setBusySeat(seatKey);
    try {
      await api(`/api/events/${showId}/holds`, { method: 'POST', body: { seatKey } });
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusySeat(null);
      await load().catch(() => {});
    }
  };

  const release = async (bookingId) => {
    try {
      await api(`/api/holds/${bookingId}`, { method: 'DELETE' });
    } catch (err) {
      push(err.message, 'error');
    }
    await load().catch(() => {});
  };

  // Navigates away to the payment page on success.
  const checkout = async (bookingIds, email) => {
    try {
      const { url } = await api('/api/checkout', { method: 'POST', body: { bookingIds, email } });
      window.location.assign(url);
    } catch (err) {
      push(err.message, 'error');
      await load().catch(() => {});
      throw err;
    }
  };

  const joinWaitlist = async (email) => {
    try {
      await api(`/api/events/${showId}/waitlist`, { method: 'POST', body: { email } });
      push("You're on the waitlist. We'll hold the next free seat for you.", 'success');
    } catch (err) {
      push(err.message, 'error');
    }
    await load().catch(() => {});
  };

  const leaveWaitlist = async () => {
    await api(`/api/events/${showId}/waitlist`, { method: 'DELETE' }).catch((err) => push(err.message, 'error'));
    await load().catch(() => {});
  };

  const show = state?.show;
  const title = show ? `${show.movie.title} · ${show.theatre.name}` : state?.event.name;
  const live = (
    <span className={`live-pill${connected ? ' on' : ''}`} role="status">
      <span className="dot" aria-hidden="true" />
      {connected ? `${viewers ?? 1} viewing` : 'Reconnecting…'}
    </span>
  );

  if (loadError) {
    return (
      <Page title="Show unavailable">
        <EmptyState
          title="This show isn't available"
          action={
            <Link to="/" className="btn btn-primary">
              Browse movies
            </Link>
          }
        >
          {loadError}
        </EmptyState>
      </Page>
    );
  }
  if (!state) {
    return (
      <Page title="Loading seats">
        <Spinner label="Loading seats… the free server can take up to a minute to wake." />
      </Page>
    );
  }

  const { event, seats, counts, yourHolds, tickets, waitlist, limits, payments } = state;
  const serverNow = now + clockOffset;
  const total = yourHolds.reduce((sum, h) => sum + h.amountMinor, 0);
  const locked = !event.upcoming;

  return (
    <Page city={show?.city.slug} title={title} topRight={live}>
      {show && (
        <Link to={`/${show.city.slug}/movies/${show.movie.id}?date=${istDate(event.startsAt)}`} className="back-link">
          <ArrowLeftIcon width={16} height={16} /> Change showtime
        </Link>
      )}

      {banner && (
        <div className={`alert alert-${banner.kind}`} role="status">
          <span>
            {banner.text}{' '}
            {banner.link && (
              <Link to="/tickets" className="text-link">
                View tickets
              </Link>
            )}
          </span>
          <button className="icon-btn" onClick={() => setBanner(null)} aria-label="Dismiss">
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      )}
      {locked && (
        <div className="alert alert-warn" role="status">
          This show has started, so seats can no longer be booked.
        </div>
      )}

      <ShowBar event={event} show={show} counts={counts} />

      <div className="booking-layout">
        <section className="card seat-card" aria-labelledby="event-title">
          <SeatMap seats={seats} busySeat={busySeat} onPick={holdSeat} currency={event.currency} stageLabel={show ? 'Screen this way' : 'Stage'} locked={locked} />
        </section>

        <aside className="booking-side">
          <OrderSummary
            holds={yourHolds}
            tickets={tickets}
            serverNow={serverNow}
            currency={event.currency}
            limits={limits}
            payments={payments}
            locked={locked}
            onRemove={release}
            onCheckout={checkout}
          />
          {(counts.available === 0 || waitlist.joined) && !locked && (
            <WaitlistCard waitlist={waitlist} minutes={Math.round(limits.waitlistHoldSeconds / 60)} onJoin={joinWaitlist} onLeave={leaveWaitlist} />
          )}
          <ActivityFeed items={activity} serverNow={serverNow} />
          <p className="hint">
            <strong>Try it with a friend:</strong> open this show in two windows and select a seat in one. It locks in the
            other instantly.
          </p>
        </aside>
      </div>

      {yourHolds.length > 0 && (
        <div className="paybar">
          <div>
            <strong>{formatPrice(total, event.currency)}</strong>
            <span className="muted small">
              {' '}
              · {yourHolds.length} {yourHolds.length === 1 ? 'seat' : 'seats'}
            </span>
          </div>
          <a href="#order-summary" className="btn btn-primary">
            Continue
          </a>
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </Page>
  );
}
