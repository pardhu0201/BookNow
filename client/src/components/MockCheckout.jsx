import { useEffect, useState } from 'react';
import { api, formatCountdown, formatPrice } from '../api.js';

export default function MockCheckout({ bookingId }) {
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api(`/api/bookings/${bookingId}`)
      .then((b) => {
        setOffset(Date.parse(b.serverTime) - Date.now());
        setBooking(b);
      })
      .catch((err) => setError(err.message));
  }, [bookingId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const back = (payment) =>
    window.location.assign(`/shows/${booking?.eventId ?? ''}?payment=${payment}&booking=${bookingId}`);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/payments/mock/${bookingId}`, { method: 'POST' });
      back('success');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!booking) {
    return (
      <div className="center-page">
        {error ? (
          <div className="card notice">
            <h1>Checkout unavailable</h1>
            <p>{error}</p>
            <a className="btn primary" href="/">
              Back to seats
            </a>
          </div>
        ) : (
          <div className="spinner" aria-label="Loading checkout" />
        )}
      </div>
    );
  }

  const left = Date.parse(booking.expiresAt) - (now + offset);
  const price = formatPrice(booking.amountMinor, booking.currency);

  return (
    <div className="center-page">
      <div className="card checkout">
        <p className="eyebrow">BookNow test checkout</p>
        <h1 className="checkout-amount">{price}</h1>
        <p>
          {booking.eventName} · Seat <b>{booking.seatKey}</b> ({booking.tier})
        </p>

        {booking.status === 'held' && left > 0 && (
          <p className="checkout-timer">Your hold ends in {formatCountdown(left)}</p>
        )}
        {booking.status === 'confirmed' && <p className="checkout-ok">This booking is already paid.</p>}
        {(booking.status === 'expired' || (booking.status === 'held' && left <= 0)) && (
          <p className="checkout-warn">
            Your hold has ended. You can still pay: if the seat is still free it is yours, otherwise you are refunded.
          </p>
        )}

        <div className="fake-card" aria-hidden="true">
          <label className="field">
            <span>Card number</span>
            <input readOnly value="4242 4242 4242 4242" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Expiry</span>
              <input readOnly value="12 / 34" />
            </label>
            <label className="field">
              <span>CVC</span>
              <input readOnly value="123" />
            </label>
          </div>
        </div>

        {error && <p className="checkout-warn">{error}</p>}
        <button className="btn primary block" onClick={pay} disabled={busy || booking.status === 'confirmed'}>
          {busy ? 'Processing…' : `Pay ${price}`}
        </button>
        <button className="btn ghost block" onClick={() => back('cancelled')} disabled={busy}>
          Cancel and go back
        </button>
        <p className="muted small">
          Demo payment mode: no real money moves. With Stripe test keys configured on the server, this step is real
          Stripe Checkout instead.
        </p>
      </div>
    </div>
  );
}
