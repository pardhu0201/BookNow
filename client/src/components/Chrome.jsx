import { useEffect, useState } from 'react';
import { Link, navigate } from '../router.jsx';
import { getJson, saveCity } from '../api.js';

let citiesPromise = null;
export function useCities() {
  const [cities, setCities] = useState([]);
  useEffect(() => {
    citiesPromise ??= getJson('/api/cities').then((d) => d.cities);
    citiesPromise.then(setCities).catch(() => {
      citiesPromise = null;
    });
  }, []);
  return cities;
}

export function TopBar({ city, children }) {
  const cities = useCities();
  return (
    <header className="topbar">
      <Link to={city ? `/${city}` : '/'} className="brand">
        <span className="logo" aria-hidden="true">
          B
        </span>
        BookNow
      </Link>
      <div className="topbar-right">
        {children}
        {cities.length > 0 && (
          <label className="city-select">
            <span className="sr-only">City</span>
            <select
              value={city || ''}
              onChange={(e) => {
                saveCity(e.target.value);
                navigate(`/${e.target.value}`);
              }}
            >
              {!city && (
                <option value="" disabled>
                  Choose city
                </option>
              )}
              {cities.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <p>
        <strong>Portfolio demo.</strong> BookNow is not affiliated with any cinema, studio or ticketing company, and no real
        tickets are sold. Showtimes and prices are simulated; payments use a test checkout.
      </p>
      <p>
        Film details and posters from{' '}
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          TMDB
        </a>
        ; BookNow is not endorsed or certified by TMDB. ·{' '}
        <a href="https://github.com/pardhu0201/BookNow" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </p>
    </footer>
  );
}

// Poster with a graceful fallback if the image CDN is unreachable.
export function Poster({ movie, className = 'poster' }) {
  const [failed, setFailed] = useState(false);
  if (failed || !movie.posterUrl) {
    return (
      <div className={`${className} poster-fallback`} aria-hidden="true">
        {movie.title}
      </div>
    );
  }
  return <img className={className} src={movie.posterUrl} alt={`${movie.title} poster`} loading="lazy" onError={() => setFailed(true)} />;
}
