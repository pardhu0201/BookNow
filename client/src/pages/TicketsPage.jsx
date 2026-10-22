import { useEffect, useState } from 'react';
import { api, formatPrice } from '../api.js';
import { Link } from '../router.jsx';
import { Page, Poster, Spinner, EmptyState } from '../components/Chrome.jsx';

const dateFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const timeFormat = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function TicketCard({ order, past }) {
  const ref = order.orderId.replace(/^cs_test_/, '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return (
    <article className={`ticket-card${past ? ' past' : ''}`}>
      <div className="ticket-main">
        {order.posterUrl && <Poster movie={{ title: order.title, posterUrl: order.posterUrl }} className="ticket-poster" />}
        <div className="ticket-info">
          <h3>{order.title}</h3>
          <p className="muted small">{[order.language, order.certification].filter(Boolean).join(' · ')}</p>
          <p className="ticket-where">
            {order.theatre}
            {order.screen ? ` · ${order.screen}` : ''}
          </p>
          <div className="ticket-when">
            <span>{dateFormat.format(new Date(order.startsAt))}</span>
            <strong>{timeFormat.format(new Date(order.startsAt))}</strong>
          </div>
        </div>
      </div>
      <div className="ticket-stub">
        <div>
          <span className="stub-label">Seats</span>
          <div className="chip-row">
            {order.seats.map((s) => (
              <span key={s.seatKey} className="seat-badge booked" title={s.tier}>
                {s.seatKey}
              </span>
            ))}
          </div>
          {order.refundedSeats.length > 0 && <p className="muted small">Refund pending: {order.refundedSeats.join(', ')}</p>}
        </div>
        <div className="stub-row">
          <div>
            <span className="stub-label">Booking ID</span>
            <code>{ref}</code>
          </div>
          <div>
            <span className="stub-label">Paid</span>
            <strong>{formatPrice(order.totalMinor, order.currency)}</strong>
          </div>
        </div>
        {!past && order.seats.length > 0 && <span className="pill pill-success">Confirmed</span>}
      </div>
    </article>
  );
}

export default function TicketsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api('/api/me/tickets')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <Page title="My tickets">
      <div className="section-head">
        <div>
          <h1 className="page-title">My tickets</h1>
          <p className="muted">Tickets are saved in this browser.</p>
        </div>
      </div>
      {error && <EmptyState title="We couldn't load your tickets">{error}</EmptyState>}
      {!data && !error && <Spinner label="Loading your tickets…" />}
      {data && data.upcoming.length === 0 && data.past.length === 0 && (
        <EmptyState
          title="No tickets yet"
          action={
            <Link to="/" className="btn btn-primary">
              Browse movies
            </Link>
          }
        >
          When you book seats, your tickets show up here.
        </EmptyState>
      )}
      {data?.upcoming.length > 0 && (
        <div className="ticket-list">
          {data.upcoming.map((o) => (
            <TicketCard key={`${o.orderId}-${o.eventId}`} order={o} />
          ))}
        </div>
      )}
      {data?.past.length > 0 && (
        <>
          <h2 className="subhead">Past</h2>
          <div className="ticket-list">
            {data.past.map((o) => (
              <TicketCard key={`${o.orderId}-${o.eventId}`} order={o} past />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
