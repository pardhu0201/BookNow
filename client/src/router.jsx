import { useEffect, useState } from 'react';

// A tiny history-API router: shareable URLs and a working Back button,
// without pulling in a routing library for five routes.
const listeners = new Set();

export function navigate(to, { replace = false } = {}) {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.scrollTo(0, 0);
  listeners.forEach((fn) => fn());
}

export function useLocation() {
  const read = () => ({ path: window.location.pathname, search: window.location.search });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const update = () => setLoc(read());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return loc;
}

export function Link({ to, children, ...rest }) {
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
