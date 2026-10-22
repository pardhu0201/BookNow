import { useCallback, useEffect, useState } from 'react';
import { Link, navigate } from '../router.jsx';
import { getJson, formatTime, runtimeLabel } from '../api.js';
import { Page, Poster, Spinner, EmptyState } from '../components/Chrome.jsx';
import { ArrowLeftIcon, StarIcon } from '../components/icons.jsx';

const REFRESH_MS = 15_000;

function availability(show) {
  const share = show.available / show.total;
  if (show.available === 0) return { tone: 'soldout', label: 'Sold out' };
  if (share < 0.15) return { tone: 'almost', label: `${show.available} left` };
  if (share < 0.4) return { tone: 'fast', label: 'Filling fast' };
  return { tone: 'open', label: 'Available' };
}

const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
const dayNum = new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' });
const month = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' });

function DateTab({ ymd, active, onClick }) {
  const d = new Date(`${ymd}T12:00:00+05:30`);
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return (
    <button type="button" className={`date-tab${active ? ' active' : ''}`} aria-pressed={active} onClick={onClick}>
      <span className="date-tab-day">{ymd === today ? 'Today' : weekday.format(d)}</span>
      <span className="date-tab-num">{dayNum.format(d)}</span>
      <span className="date-tab-month">{month.format(d)}</span>
    </button>
  );
}

export default function ShowtimesPage({ city, movieId, date }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    const q = date ? `?date=${date}` : '';
    return getJson(`/api/cities/${city}/movies/${movieId}/shows${q}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, [city, movieId, date]);

  // Seat counts change as people book; keep the times fresh.
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const movie = data?.movie;
  const base = `/${city}/movies/${movieId}`;

  return (
    <Page city={city} title={movie ? `${movie.title} showtimes` : 'Showtimes'}>
      <Link to={`/${city}`} className="back-link">
        <ArrowLeftIcon width={16} height={16} /> All movies
      </Link>
      {error && !data && <EmptyState title="We couldn't load showtimes">{error}</EmptyState>}
      {!data && !error && <Spinner label="Loading showtimes…" />}
      {movie && (
        <>
          <section className="movie-banner">
            {movie.backdropUrl && <img className="banner-bg" src={movie.backdropUrl} alt="" aria-hidden="true" />}
            <div className="banner-shade" />
            <div className="banner-body">
              <Poster movie={movie} className="banner-poster" />
              <div className="banner-text">
                <h1>{movie.title}</h1>
                <div className="tag-row">
                  <span className="pill pill-light">{movie.language}</span>
                  {movie.certification && <span className="pill pill-light">{movie.certification}</span>}
                  {runtimeLabel(movie.runtimeMinutes) && <span className="pill pill-light">{runtimeLabel(movie.runtimeMinutes)}</span>}
                  {movie.rating !== null && (
                    <span className="pill pill-gold">
                      <StarIcon width={13} height={13} /> {movie.rating.toFixed(1)} TMDB
                    </span>
                  )}
                </div>
                <p className="banner-genres">{movie.genres.join(' · ')}</p>
                <p className="banner-overview">{movie.overview}</p>
                <dl className="credits">
                  {movie.director && (
                    <div>
                      <dt>Director</dt>
                      <dd>{movie.director}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Cast</dt>
                    <dd>{movie.cast.join(', ')}</dd>
                  </div>
                </dl>
                <a className="banner-link" href={movie.tmdbUrl} target="_blank" rel="noreferrer">
                  View on TMDB ↗
                </a>
              </div>
            </div>
          </section>

          {data.dates.length === 0 ? (
            <EmptyState title="No upcoming shows">This film has no more shows in {data.city.name} in the next few days.</EmptyState>
          ) : (
            <section className="showtimes">
              <div className="showtimes-bar">
                <nav className="date-tabs" aria-label="Choose a date">
                  {data.dates.map((d) => (
                    <DateTab key={d} ymd={d} active={d === data.date} onClick={() => navigate(`${base}?date=${d}`, { replace: true })} />
                  ))}
                </nav>
                <div className="avail-legend" aria-hidden="true">
                  <span>
                    <i className="dot open" /> Available
                  </span>
                  <span>
                    <i className="dot fast" /> Filling fast
                  </span>
                  <span>
                    <i className="dot almost" /> Almost full
                  </span>
                </div>
              </div>

              <ul className="theatre-list">
                {data.theatres.map((t) => (
                  <li key={t.id} className="theatre-row">
                    <div className="theatre-name">
                      <strong>{t.name}</strong>
                      <span className="muted small">{t.area}</span>
                    </div>
                    <div className="time-chips">
                      {t.shows.map((s) => {
                        const a = availability(s);
                        const content = (
                          <>
                            <span className="time">{formatTime(s.startsAt)}</span>
                            <span className="time-sub">{a.label}</span>
                          </>
                        );
                        return a.tone === 'soldout' ? (
                          <span key={s.id} className="time-chip soldout" aria-disabled="true">
                            {content}
                          </span>
                        ) : (
                          <Link
                            key={s.id}
                            to={`/shows/${s.id}`}
                            className={`time-chip ${a.tone}`}
                            title={`${s.screen} · ${s.available} of ${s.total} seats free`}
                          >
                            {content}
                          </Link>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Page>
  );
}
