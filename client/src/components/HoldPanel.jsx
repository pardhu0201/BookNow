import { useState } from 'react';
import { formatCountdown, formatPrice, savedEmail, saveEmail } from '../api.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function HoldPanel({ holds, tickets, serverNow, currency, limits, payments, onRelease, onCheckout }) {
  const [email, setEmail] = useState(savedEmail);
  const [busy, setBusy] = useState(null);
  const emailOk = EMAIL.test(email.trim());

  if (!holds.length && !tickets.length) {
    return (
      <div className="card panel">
        <h2>Your seats</h2>
        <p>
          Tap a seat to hold it for {Math.round(limits.holdSeconds / 60)} minutes. While you pay, nobody else can
          take it.
        </p>
        <p className="muted small">You can hold up to {limits.maxHoldsPerSession} seats at once.</p>
      </div>
    );
  }

  const pay = async (id) => {
    saveEmail(email.trim());
    setBusy(id);
    try {
      await onCheckout(id, email.trim());
    } catch {
      setBusy(null);
    }
  };

  return (
    <div className="card panel">
      <h2>Your seats</h2>
      {holds.length > 0 && (
        <>
          <label className="field">
            <span>Email for your ticket</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <ul className="holds">
            {holds.map((h) => {
              const left = Date.parse(h.expiresAt) - serverNow;
              const span = (h.source === 'waitlist' ? limits.waitlistHoldSeconds : limits.holdSeconds) * 1000;
              const pct = Math.max(0, Math.min(100, (left / span) * 100));
              return (
                <li key={h.id} className={`hold${left < 60_000 ? ' urgent' : ''}`}>
                  <div className="hold-top">
                    <div>
                      <span className="hold-seat">{h.seatKey}</span>
                      <span className="muted small">
                        {' '}
                        {h.tier} · {formatPrice(h.amountMinor, currency)}
                        {h.source === 'waitlist' ? ' · from waitlist' : ''}
                      </span>
                    </div>
                    <span className="hold-timer" aria-label="Time left on hold">
                      {left > 0 ? formatCountdown(left) : 'Ending…'}
                    </span>
                  </div>
                  <div className="bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <div className="hold-actions">
                    <button className="btn primary" disabled={!emailOk || busy !== null || left <= 0} onClick={() => pay(h.id)}>
                      {busy === h.id ? 'Opening checkout…' : `Pay ${formatPrice(h.amountMinor, currency)}`}
                    </button>
                    <button className="btn ghost" disabled={busy !== null} onClick={() => onRelease(h.id)}>
                      Release
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {!emailOk && <p className="muted small">Enter your email to pay.</p>}
          {payments === 'mock' && <p className="muted small">Test mode: payment is simulated, no card needed.</p>}
        </>
      )}

      {tickets.length > 0 && (
        <div className="tickets">
          <h3>Tickets</h3>
          <ul>
            {tickets.map((t) => (
              <li key={t.id} className={`ticket ticket-${t.status}`}>
                <span className="hold-seat">{t.seatKey}</span>
                <span className="muted small">
                  {t.tier} · {formatPrice(t.amountMinor, currency)}
                </span>
                <span className="badge">{t.status === 'confirmed' ? 'Confirmed' : 'Refund pending'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
