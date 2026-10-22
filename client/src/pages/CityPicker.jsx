import { navigate } from '../router.jsx';
import { saveCity } from '../api.js';
import { TopBar, Footer, useCities } from '../components/Chrome.jsx';

export default function CityPicker() {
  const cities = useCities();
  const pick = (slug) => {
    saveCity(slug);
    navigate(`/${slug}`);
  };
  return (
    <div className="app">
      <TopBar />
      <main className="city-page">
        <h1>Pick your city</h1>
        <p className="muted">See what's playing near you and book seats in real time.</p>
        {cities.length === 0 ? (
          <div className="spinner" aria-label="Loading cities" />
        ) : (
          <div className="city-grid">
            {cities.map((c) => (
              <button key={c.slug} type="button" className="card city-card" onClick={() => pick(c.slug)}>
                <span className="city-initial" aria-hidden="true">
                  {c.name[0]}
                </span>
                <span className="city-name">{c.name}</span>
                <span className="muted small">{c.theatres} cinemas</span>
              </button>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
