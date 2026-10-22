import { useMemo } from 'react';
import { formatPrice } from '../api.js';

const STATE_LABEL = { available: 'available', mine: 'held by you', held: 'held by someone else', sold: 'sold' };

export default function SeatMap({ seats, busySeat, onPick, currency, stageLabel = 'Stage' }) {
  const rows = useMemo(() => {
    const byRow = new Map();
    for (const seat of seats) {
      if (!byRow.has(seat.row)) byRow.set(seat.row, []);
      byRow.get(seat.row).push(seat);
    }
    return [...byRow.entries()];
  }, [seats]);

  return (
    <div className="seatmap">
      <div className="stage" aria-hidden="true">
        {stageLabel}
      </div>
      <div className="rows" role="group" aria-label="Seat map">
        {rows.map(([row, list]) => {
          const aisleAfter = Math.ceil(list.length / 2);
          return (
            <div className="row" key={row}>
              <span className="row-label" aria-hidden="true">
                {row}
              </span>
              <div className="row-seats">
                {list.map((s) => {
                  const state = s.heldByYou ? 'mine' : s.status;
                  const label = `Seat ${s.seatKey}, ${s.tier}, ${formatPrice(s.priceMinor, currency)}, ${STATE_LABEL[state]}`;
                  return (
                    <button
                      key={s.seatKey}
                      type="button"
                      className={`seat seat-${state} tier-${s.tier.toLowerCase()}${busySeat === s.seatKey ? ' busy' : ''}${
                        s.number === aisleAfter ? ' aisle' : ''
                      }`}
                      disabled={s.status !== 'available' || busySeat !== null}
                      onClick={() => onPick(s.seatKey)}
                      aria-label={label}
                      title={label}
                    >
                      {s.number}
                    </button>
                  );
                })}
              </div>
              <span className="row-label" aria-hidden="true">
                {row}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
