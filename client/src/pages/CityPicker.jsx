import { navigate } from '../router.jsx';
import { saveCity } from '../api.js';
import { Page, Spinner, useCities } from '../components/Chrome.jsx';
import { PinIcon } from '../components/icons.jsx';

export default function CityPicker() {
  const cities = useCities();
  const pick = (slug) => {
    saveCity(slug);
    navigate(`/${slug}`);
  };
  return (
    <Page title="Choose your city">
      <section className="city-page">
        <p className="eyebrow">Movie tickets, booked in real time</p>
        <h1 className="display">Where are you watching?</h1>
        <p className="lead muted">Pick a city to see what's playing and grab seats before anyone else does.</p>
        {cities.length === 0 ? (
          <Spinner label="Loading cities…" />
        ) : (
          <div className="city-grid">
            {cities.map((c) => (
              <button key={c.slug} type="button" className="city-card" onClick={() => pick(c.slug)}>
                <span className="city-icon">
                  <PinIcon />
                </span>
                <span className="city-name">{c.name}</span>
                <span className="muted small">{c.theatres} cinemas</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}
