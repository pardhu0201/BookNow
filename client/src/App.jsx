import EventPage from './EventPage.jsx';
import MockCheckout from './components/MockCheckout.jsx';

export default function App() {
  const mock = window.location.pathname.match(/^\/checkout\/mock\/([0-9a-f-]{36})\/?$/i);
  if (mock) return <MockCheckout bookingId={mock[1]} />;
  return <EventPage />;
}
