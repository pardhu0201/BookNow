import { useState } from 'react';
import { savedEmail, saveEmail } from '../api.js';

export default function WaitlistCard({ waitlist, minutes, onJoin, onLeave }) {
  const [email, setEmail] = useState(savedEmail);
  const [busy, setBusy] = useState(false);

  if (waitlist.joined) {
    return (
      <div className="card panel waitlist">
        <h2>You're on the waitlist</h2>
        <p className="position">
          #{waitlist.position} <span className="muted">of {waitlist.length} waiting</span>
        </p>
        <p className="small">
          When a seat frees up, it is held for the first person in line for {minutes} minutes, before anyone else can
          see it.
        </p>
        <button className="btn ghost" onClick={onLeave}>
          Leave waitlist
        </button>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    saveEmail(email.trim());
    await onJoin(email.trim());
    setBusy(false);
  };

  return (
    <form className="card panel waitlist" onSubmit={submit}>
      <h2>Sold out right now</h2>
      <p className="small">
        Join the waitlist. If someone releases a seat or lets a hold run out, the first person in line gets it.
      </p>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <button className="btn primary" disabled={busy}>
        {busy ? 'Joining…' : 'Join waitlist'}
      </button>
      {waitlist.length > 0 && <p className="muted small">{waitlist.length} already waiting</p>}
    </form>
  );
}
