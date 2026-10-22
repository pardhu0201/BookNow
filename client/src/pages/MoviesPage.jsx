import { useEffect, useMemo, useState } from 'react';
import { Link } from '../router.jsx';
import { getJson, saveCity, runtimeLabel } from '../api.js';
import { Page, Poster, Spinner, EmptyState } from '../components/Chrome.jsx';
import { StarIcon } from '../components/icons.jsx';

function Featured({ city, movie }) {
  return (
    <section className="featured">
      {movie.backdropUrl && <img className="featured-bg" src={movie.backdropUrl} alt="" aria-hidden="true" />}
      <div className="featured-shade" />
      <div className="featured-body">
        <Poster movie={movie} className="featured-poster" />
        <div className="featured-text">
          <span className="pill pill-light">Now showing</span>
          <h1>{movie.title}</h1>
          <p className="featured-meta">
            {[movie.language, runtimeLabel(movie.runtimeMinutes), movie.genres.join(', ')].filter(Boolean).join(' · ')}
          </p>
          <p className="featured-overview">{movie.overview}</p>
          <Link to={`/${city}/movies/${movie.id}`} className="btn btn-primary btn-lg">
            Book tickets
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function MoviesPage({ city }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [language, setLanguage] = useState('All');

  useEffect(() => {
    getJson(`/api/cities/${city}/movies`)
      .then((d) => {
        saveCity(city);
        setData(d);
      })
      .catch((err) => setError(err.message));
  }, [city]);

  const languages = useMemo(() => ['All', ...new Set((data?.movies ?? []).map((m) => m.language))], [data]);
  const shown = (data?.movies ?? []).filter((m) => language === 'All' || m.language === language);
  const featured = data?.movies.find((m) => !m.advanceBooking);

  return (
    <Page city={city} title={data ? `Movies in ${data.city.name}` : 'Movies'}>
      {error && (
        <EmptyState
          title="We couldn't load movies"
          action={
            <Link to="/cities" className="btn btn-primary">
              Choose another city
            </Link>
          }
        >
          {error}
        </EmptyState>
      )}
      {!data && !error && <Spinner label="Loading movies… the free server can take up to a minute to wake." />}
      {data && (
        <>
          {featured && <Featured city={city} movie={featured} />}
          <div className="section-head">
            <div>
              <h2>Now showing in {data.city.name}</h2>
              <p className="muted">{data.movies.length} films over the next 3 days</p>
            </div>
            <div className="segmented" role="group" aria-label="Filter by language">
              {languages.map((l) => (
                <button key={l} type="button" className={l === language ? 'active' : ''} aria-pressed={l === language} onClick={() => setLanguage(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="movie-grid">
            {shown.map((m) => (
              <Link key={m.id} to={`/${city}/movies/${m.id}`} className="movie-card">
                <div className="poster-wrap">
                  <Poster movie={m} />
                  {m.advanceBooking && <span className="poster-tag">Advance booking</span>}
                </div>
                <div className="movie-info">
                  <span className="movie-title">{m.title}</span>
                  <span className="movie-meta">
                    {[m.language, m.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
                  </span>
                  <span className="movie-foot">
                    {m.rating !== null && (
                      <span className="rating">
                        <StarIcon width={14} height={14} /> {m.rating.toFixed(1)}
                      </span>
                    )}
                    {runtimeLabel(m.runtimeMinutes) && <span className="muted">{runtimeLabel(m.runtimeMinutes)}</span>}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
