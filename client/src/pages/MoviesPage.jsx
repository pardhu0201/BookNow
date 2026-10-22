import { useEffect, useState } from 'react';
import { Link } from '../router.jsx';
import { getJson, saveCity, runtimeLabel } from '../api.js';
import { TopBar, Footer, Poster } from '../components/Chrome.jsx';

export default function MoviesPage({ city }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getJson(`/api/cities/${city}/movies`)
      .then((d) => {
        saveCity(city);
        setData(d);
      })
      .catch((err) => setError(err.message));
  }, [city]);

  return (
    <div className="app">
      <TopBar city={city} />
      <main>
        {error && (
          <div className="card notice">
            <h1>Can't load movies</h1>
            <p>{error}</p>
            <Link to="/cities" className="btn primary">
              Choose another city
            </Link>
          </div>
        )}
        {!data && !error && (
          <div className="center-block">
            <div className="spinner" aria-label="Loading movies" />
            <p className="muted">Loading… the free server may take up to a minute to wake.</p>
          </div>
        )}
        {data && (
          <>
            <div className="page-head">
              <h1>Movies in {data.city.name}</h1>
              <p className="muted">{data.movies.length} films showing over the next 3 days</p>
            </div>
            <div className="movie-grid">
              {data.movies.map((m) => (
                <Link key={m.id} to={`/${city}/movies/${m.id}`} className="movie-card">
                  <div className="poster-wrap">
                    <Poster movie={m} />
                    {m.advanceBooking ? (
                      <span className="poster-badge">Advance booking</span>
                    ) : (
                      m.rating !== null && <span className="poster-badge rating">★ {m.rating.toFixed(1)}</span>
                    )}
                  </div>
                  <span className="movie-title">{m.title}</span>
                  <span className="muted small">
                    {[m.language, m.genres.slice(0, 2).join('/'), runtimeLabel(m.runtimeMinutes)].filter(Boolean).join(' · ')}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
