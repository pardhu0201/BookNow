import { useState } from 'react';
import { Link } from '../router.jsx';
import { formatCountdown, formatPrice, savedEmail, saveEmail } from '../api.js';
import { ClockIcon, CloseIcon, LockIcon, TicketIcon } from './icons.jsx';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function OrderSummary({ holds, tickets, serverNow, currency, limits, payments, locked, onRemove, onCheckout }) {
  const [email, setEmail] = useState(savedEmail);
  const [busy, setBusy] = useState(false);
  const emailOk = EMAIL.test(email.trim());
  const total = holds.reduce((sum, h) => sum + h.amountMinor, 0);
  const endsAt = holds.length ? Math.min(...holds.map((h) => Date.parse(h.expiresAt))) : 0;
  const left = endsAt - serverNow;
  const span = (holds.some((h) => h.source === 'waitlist') ? limits.waitlistHoldSeconds : limits.holdSeconds) * 1000;

  const pay = async () => {
    saveEmail(email.trim());
    setBusy(true);
    try {
      await onCheckout(
        holds.map((h) => h.id),
        email.trim()
      );
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="card summary" id="order-summary">
      <div className="summary-head">
        <h2>Your seats</h2>
        {holds.length > 0 && (
          <span className={`timer-pill${left < 60_000 ? ' urgent' : ''}`} aria-label="Time left on your hold">
            <ClockIcon width={14} height={14} />
            {left > 0 ? formatCountdown(left) : 'Ending…'}
          </span>
        )}
      </div>

      {holds.length === 0 ? (
        <div className="summary-empty">
          <span className="summary-empty-icon">
            <TicketIcon width={22} height={22} />
          </span>
          <p>
            <strong>No seats selected</strong>
          </p>
          <p className="muted small">
            Tap seats on the map. Each is held for you for {Math.round(limits.holdSeconds / 60)} minutes while you pay, up
            to {limits.maxHoldsPerSession} at a time.
          </p>
        </div>
      ) : (
        <>
          <div className="hold-bar" aria-hidden="true">
            <span className={left < 60_000 ? 'urgent' : ''} style={{ width: `${Math.max(0, Math.min(100, (left / span) * 100))}%` }} />
          </div>
          <ul className="summary-lines">
            {holds.map((h) => (
              <li key={h.id}>
                <span className="seat-badge">{h.seatKey}</span>
                <span className="line-tier">
                  {h.tier}
                  {h.source === 'waitlist' && <span className="muted small"> · from waitlist</span>}
                </span>
                <span className="line-price">{formatPrice(h.amountMinor, currency)}</span>
                <button type="button" className="icon-btn" onClick={() => onRemove(h.id)} aria-label={`Release seat ${h.seatKey}`} disabled={busy}>
                  <CloseIcon width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
          <div className="summary-total">
            <span>
              Total <span className="muted small">({holds.length} {holds.length === 1 ? 'seat' : 'seats'})</span>
            </span>
            <strong>{formatPrice(total, currency)}</strong>
          </div>
          <label className="field">
            <span>Email for your tickets</span>
            <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary btn-block btn-lg" disabled={!emailOk || busy || left <= 0 || locked} onClick={pay}>
            {busy ? 'Opening checkout…' : `Pay ${formatPrice(total, currency)}`}
          </button>
          <p className="secure-note">
            <LockIcon width={14} height={14} />
            {payments === 'mock' ? 'Test checkout: no card or real payment needed.' : 'Secure payment by Stripe (test mode).'}
          </p>
        </>
      )}

      {tickets.length > 0 && (
        <div className="summary-tickets">
          <h3>Booked for this show</h3>
          <div className="chip-row">
            {tickets.map((t) => (
              <span key={t.id} className={`seat-badge${t.status === 'confirmed' ? ' booked' : ' refunded'}`} title={t.status === 'confirmed' ? 'Confirmed' : 'Refund pending'}>
                {t.seatKey}
              </span>
            ))}
          </div>
          <Link to="/tickets" className="text-link">
            View in My tickets →
          </Link>
        </div>
      )}
    </div>
  );
}
