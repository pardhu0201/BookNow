import { useCallback, useState } from 'react';

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (text, kind = 'info') => {
      const id = Math.random().toString(36).slice(2);
      setToasts((all) => [...all.slice(-3), { id, text, kind }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss]
  );
  return { toasts, push, dismiss };
}

export default function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast-${t.kind}`} onClick={() => onDismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
