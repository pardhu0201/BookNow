const VERB = {
  held: 'was just held',
  sold: 'sold',
  released: 'was released',
  expired: 'hold ran out',
};

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export default function ActivityFeed({ items, serverNow }) {
  return (
    <div className="card panel">
      <h2>Live activity</h2>
      {items.length === 0 ? (
        <p className="muted small">What everyone on this page does with seats shows up here as it happens.</p>
      ) : (
        <ul className="feed" aria-live="polite">
          {items.map((a) => (
            <li key={a.key}>
              <span className={`pip pip-${a.type}`} aria-hidden="true" />
              <span className="feed-text">
                {a.type === 'reset' ? (
                  'Demo hall refilled'
                ) : (
                  <>
                    Seat <b>{a.seatKey}</b> {VERB[a.type]}
                  </>
                )}
              </span>
              <time className="muted small">{ago(serverNow - Date.parse(a.at))}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
