import { useMemo } from 'react';
import { formatPrice } from '../api.js';

const STATE_LABEL = { available: 'available', mine: 'selected by you', held: 'held by someone else', sold: 'sold' };

// Cinema layout: back rows (premium) at the top, the screen at the bottom,
// rows grouped under a header per price tier.
export default function SeatMap({ seats, busySeat, onPick, currency, stageLabel = 'Screen', locked = false }) {
  const sections = useMemo(() => {
    const byRow = new Map();
    for (const seat of seats) {
      if (!byRow.has(seat.row)) byRow.set(seat.row, []);
      byRow.get(seat.row).push(seat);
    }
    const rows = [...byRow.entries()].reverse();
    const out = [];
    for (const [row, list] of rows) {
      const tier = list[0].tier;
      let section = out.at(-1);
      if (!section || section.tier !== tier) {
        section = { tier, price: list[0].priceMinor, rows: [] };
        out.push(section);
      }
      section.rows.push([row, list]);
    }
    return out;
  }, [seats]);

  return (
    <div className={`seatmap${locked ? ' locked' : ''}`}>
      <div className="seatmap-scroll">
        <div className="seatmap-inner" role="group" aria-label="Seat map">
          {sections.map((section) => (
            <div className="tier-section" key={section.tier + section.rows[0][0]}>
              <div className="tier-head">
                <span>{section.tier}</span>
                <span>{formatPrice(section.price, currency)}</span>
              </div>
              {section.rows.map(([row, list]) => {
                const aisleAfter = Math.ceil(list.length / 2);
                return (
                  <div className="seat-row" key={row}>
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
                            className={`seat seat-${state}${busySeat === s.seatKey ? ' busy' : ''}${s.number === aisleAfter ? ' aisle' : ''}`}
                            disabled={locked || s.status !== 'available' || busySeat !== null}
                            onClick={() => onPick(s.seatKey)}
                            aria-label={label}
                            title={label}
                          >
                            {s.number}
                          </button>
                        );
                      })}
                    </div>
                    <span className="row-label row-label-end" aria-hidden="true">
                      {row}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="screen" aria-hidden="true">
            <div className="screen-curve" />
            <span>{stageLabel}</span>
          </div>
        </div>
      </div>
      <ul className="seat-legend" aria-label="Seat legend">
        <li>
          <span className="swatch swatch-available" /> Available
        </li>
        <li>
          <span className="swatch swatch-mine" /> Selected
        </li>
        <li>
          <span className="swatch swatch-held" /> Held by others
        </li>
        <li>
          <span className="swatch swatch-sold" /> Sold
        </li>
      </ul>
    </div>
  );
}
