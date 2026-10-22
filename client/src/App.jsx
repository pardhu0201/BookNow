import { useEffect } from 'react';
import { useLocation, navigate } from './router.jsx';
import { savedCity } from './api.js';
import CityPicker from './pages/CityPicker.jsx';
import MoviesPage from './pages/MoviesPage.jsx';
import ShowtimesPage from './pages/ShowtimesPage.jsx';
import EventPage from './EventPage.jsx';
import MockCheckout from './components/MockCheckout.jsx';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function Home() {
  const city = savedCity();
  useEffect(() => {
    if (city) navigate(`/${city}`, { replace: true });
  }, [city]);
  return city ? null : <CityPicker />;
}

export default function App() {
  const { path, search } = useLocation();
  let m;
  if ((m = path.match(new RegExp(`^/checkout/mock/(${UUID})/?$`, 'i')))) return <MockCheckout bookingId={m[1]} />;
  if ((m = path.match(new RegExp(`^/shows/(${UUID})/?$`, 'i')))) return <EventPage key={m[1]} showId={m[1]} />;
  if ((m = path.match(/^\/([a-z0-9-]+)\/movies\/([a-z0-9-]+)\/?$/))) {
    const date = new URLSearchParams(search).get('date');
    return <ShowtimesPage city={m[1]} movieId={m[2]} date={date} />;
  }
  if (path === '/cities') return <CityPicker />;
  if ((m = path.match(/^\/([a-z0-9-]+)\/?$/))) return <MoviesPage key={m[1]} city={m[1]} />;
  return <Home />;
}
