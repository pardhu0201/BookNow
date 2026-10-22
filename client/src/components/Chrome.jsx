import { useEffect, useState } from 'react';
import { Link, navigate, useLocation } from '../router.jsx';
import { getJson, saveCity, savedCity } from '../api.js';
import { Logo, PinIcon, TicketIcon } from './icons.jsx';

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

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · BookNow` : 'BookNow · Movie tickets';
  }, [title]);
}

export function TopBar({ city, children }) {
  const cities = useCities();
  const { path } = useLocation();
  const current = city || savedCity();
  const known = cities.some((c) => c.slug === current);
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link to={current ? `/${current}` : '/'} className="brand" aria-label="BookNow home">
          <Logo />
          <span className="brand-name">BookNow</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <Link to={current ? `/${current}` : '/'} className={`nav-link${path === `/${current}` ? ' active' : ''}`}>
            Movies
          </Link>
          <Link to="/tickets" className={`nav-link${path === '/tickets' ? ' active' : ''}`}>
            <TicketIcon width={16} height={16} />
            My tickets
          </Link>
        </nav>
        <div className="topbar-right">
          {children}
          {cities.length > 0 && (
            <label className="city-select">
              <PinIcon width={16} height={16} />
              <span className="sr-only">City</span>
              <select
                value={known ? current : ''}
                onChange={(e) => {
                  saveCity(e.target.value);
                  navigate(`/${e.target.value}`);
                }}
              >
                {!known && (
                  <option value="" disabled>
                    Select city
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
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <Logo />
          <span>BookNow</span>
        </div>
        <p>
          A portfolio demo, not affiliated with any cinema, studio or ticketing company. No real tickets are sold;
          showtimes and prices are simulated and payments use a test checkout.
        </p>
        <p>
          Film details and posters from{' '}
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            TMDB
          </a>
          . BookNow is not endorsed or certified by TMDB. ·{' '}
          <a href="https://github.com/pardhu0201/BookNow" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}

export function Page({ city, title, topRight, children, wide = false }) {
  useTitle(title);
  return (
    <div className="page">
      <TopBar city={city}>{topRight}</TopBar>
      <main className={`container main${wide ? ' wide' : ''}`}>{children}</main>
      <Footer />
    </div>
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

export function Spinner({ label }) {
  return (
    <div className="loading-block" role="status">
      <div className="spinner" />
      <p className="muted">{label}</p>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty-state card">
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}
