import { useCallback, useEffect, useState } from 'react';
import { Link, navigate } from '../router.jsx';
import { getJson, dayLabel, formatTime, runtimeLabel } from '../api.js';
import { TopBar, Footer, Poster } from '../components/Chrome.jsx';

const REFRESH_MS = 15_000;

function availability(show) {
  const share = show.available / show.total;
  if (show.available === 0) return { tone: 'soldout', label: 'Sold out' };
  if (share < 0.15) return { tone: 'almost', label: `${show.available} left` };
  if (share < 0.4) return { tone: 'fast', label: 'Filling fast' };
  return { tone: 'open', label: 'Available' };
}

export default function ShowtimesPage({ city, movieId, date }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    const q = date ? `?date=${date}` : '';
    return getJson(`/api/cities/${city}/movies/${movieId}/shows${q}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [city, movieId, date]);

  // Seat counts change as people book; keep the chips fresh.
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
    <div className="app">
      <TopBar city={city} />
      <main>
        <Link to={`/${city}`} className="back-link">
          ← All movies in {data?.city.name ?? 'this city'}
        </Link>
        {error && !data && (
          <div className="card notice">
            <h1>Can't load showtimes</h1>
            <p>{error}</p>
          </div>
        )}
        {!data && !error && <div className="spinner" aria-label="Loading showtimes" />}
        {movie && (
          <>
            <section className="movie-hero card">
              {movie.backdropUrl && <img className="hero-backdrop" src={movie.backdropUrl} alt="" aria-hidden="true" />}
              <div className="hero-body">
                <Poster movie={movie} className="hero-poster" />
                <div className="hero-text">
                  <h1>{movie.title}</h1>
                  <p className="hero-meta">
                    {[movie.language, movie.certification, runtimeLabel(movie.runtimeMinutes), movie.genres.join(', ')]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {movie.rating !== null && (
                    <p className="hero-rating">
                      ★ {movie.rating.toFixed(1)}/10 <span className="muted small">on TMDB</span>
                    </p>
                  )}
                  <p className="hero-overview">{movie.overview}</p>
                  <p className="small">
                    {movie.director && (
                      <>
                        <span className="muted">Director</span> {movie.director}
                        <br />
                      </>
                    )}
                    <span className="muted">Cast</span> {movie.cast.join(', ')}
                  </p>
                  <a className="small" href={movie.tmdbUrl} target="_blank" rel="noreferrer">
                    More on TMDB ↗
                  </a>
                </div>
              </div>
            </section>

            {data.dates.length === 0 ? (
              <div className="card notice">
                <h2>No upcoming shows</h2>
                <p className="muted">This film has no more shows in {data.city.name} in the next few days.</p>
              </div>
            ) : (
              <>
                <nav className="date-strip" aria-label="Choose a date">
                  {data.dates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`date-chip${d === data.date ? ' active' : ''}`}
                      aria-pressed={d === data.date}
                      onClick={() => navigate(`${base}?date=${d}`, { replace: true })}
                    >
                      {dayLabel(d)}
                    </button>
                  ))}
                </nav>

                <div className="legend availability-legend">
                  <span className="avail-dot open" /> Available
                  <span className="avail-dot fast" /> Filling fast
                  <span className="avail-dot almost" /> Almost full
                </div>

                <ul className="theatre-list">
                  {data.theatres.map((t) => (
                    <li key={t.id} className="card theatre">
                      <div className="theatre-name">
                        <strong>{t.name}</strong>
                        <span className="muted small">{t.area}</span>
                      </div>
                      <div className="show-chips">
                        {t.shows.map((s) => {
                          const a = availability(s);
                          return a.tone === 'soldout' ? (
                            <span key={s.id} className="show-chip soldout" title="Sold out">
                              {formatTime(s.startsAt)}
                              <small>Sold out</small>
                            </span>
                          ) : (
                            <Link
                              key={s.id}
                              to={`/shows/${s.id}`}
                              className={`show-chip ${a.tone}`}
                              title={`${s.screen} · ${s.available} of ${s.total} seats free`}
                            >
                              {formatTime(s.startsAt)}
                              <small>{a.label}</small>
                            </Link>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
