import { useEffect, useState } from 'react';
import { api, formatCountdown, formatPrice, runtimeLabel } from '../api.js';
import { navigate, Link } from '../router.jsx';
import { Page, Poster, Spinner, EmptyState } from '../components/Chrome.jsx';
import { ClockIcon, LockIcon } from '../components/icons.jsx';

const whenFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export default function CheckoutPage({ orderId }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api(`/api/orders/${encodeURIComponent(orderId)}`)
      .then((o) => {
        setOffset(Date.parse(o.serverTime) - Date.now());
        setOrder(o);
      })
      .catch((err) => setError(err.message));
  }, [orderId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const back = (payment) => navigate(`/shows/${order.eventId}?payment=${payment}&order=${encodeURIComponent(orderId)}`);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/orders/${encodeURIComponent(orderId)}/pay`, { method: 'POST' });
      back('success');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!order) {
    return (
      <Page title="Checkout">
        {error ? (
          <EmptyState
            title="Checkout unavailable"
            action={
              <Link to="/" className="btn btn-primary">
                Browse movies
              </Link>
            }
          >
            {error}
          </EmptyState>
        ) : (
          <Spinner label="Loading your order…" />
        )}
      </Page>
    );
  }

  const left = order.expiresAt ? Date.parse(order.expiresAt) - (now + offset) : 0;
  const price = formatPrice(order.totalMinor, order.currency);
  const movie = order.show?.movie;

  return (
    <Page title="Checkout">
      <div className="checkout-layout">
        <section className="card checkout-pay">
          <p className="eyebrow">Payment</p>
          <h1>Pay {price}</h1>
          {order.status === 'pending' && left > 0 && (
            <p className={`timer-pill${left < 60_000 ? ' urgent' : ''}`}>
              <ClockIcon width={14} height={14} /> Seats held for {formatCountdown(left)}
            </p>
          )}
          {order.status === 'confirmed' && <div className="alert alert-success">This order is already paid.</div>}
          {(order.status === 'expired' || (order.status === 'pending' && left <= 0)) && (
            <div className="alert alert-warn">
              Your hold has ended. You can still pay: seats that are still free are yours, the rest are refunded.
            </div>
          )}

          <div className="test-card" aria-label="Test card details">
            <div className="field">
              <span>Card number</span>
              <input readOnly value="4242 4242 4242 4242" />
            </div>
            <div className="field-row">
              <div className="field">
                <span>Expiry</span>
                <input readOnly value="12 / 34" />
              </div>
              <div className="field">
                <span>CVC</span>
                <input readOnly value="123" />
              </div>
            </div>
            <div className="field">
              <span>Email</span>
              <input readOnly value={order.email ?? ''} />
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-block btn-lg" onClick={pay} disabled={busy || order.status === 'confirmed'}>
            {busy ? 'Processing…' : `Pay ${price}`}
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => back('cancelled')} disabled={busy}>
            Cancel and return to seats
          </button>
          <p className="secure-note">
            <LockIcon width={14} height={14} /> Test checkout: no real money moves. With Stripe keys set on the server, this step is
            Stripe Checkout.
          </p>
        </section>

        <aside className="card checkout-order">
          <p className="eyebrow">Order summary</p>
          <div className="order-movie">
            {movie && <Poster movie={movie} className="order-poster" />}
            <div>
              <h2>{movie?.title ?? order.eventName}</h2>
              <p className="muted small">
                {movie ? [movie.language, movie.certification, runtimeLabel(movie.runtimeMinutes)].filter(Boolean).join(' · ') : order.venue}
              </p>
              <p className="small">
                {order.show ? `${order.show.theatre.name}, ${order.show.theatre.area} · ${order.show.screen}` : order.venue}
              </p>
              <p className="small">
                <strong>{whenFormat.format(new Date(order.startsAt))} IST</strong>
              </p>
            </div>
          </div>
          <ul className="summary-lines">
            {order.seats.map((s) => (
              <li key={s.bookingId}>
                <span className="seat-badge">{s.seatKey}</span>
                <span className="line-tier">{s.tier}</span>
                <span className="line-price">{formatPrice(s.amountMinor, order.currency)}</span>
              </li>
            ))}
          </ul>
          <div className="summary-total">
            <span>Total</span>
            <strong>{price}</strong>
          </div>
        </aside>
      </div>
    </Page>
  );
}
