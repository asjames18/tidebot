import { useStore } from '../store';

/** Global transient notifications (errors and confirmations), stacked top-center. */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast toast--item" role="status">{t.text}</div>
      ))}
    </div>
  );
}
