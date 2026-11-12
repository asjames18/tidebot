import { useStore } from '../store';

/** Global transient notifications (errors and confirmations), stacked top-center. Tap to dismiss immediately. */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const set = useStore((s) => s.set);
  if (!toasts.length) return null;
  const dismiss = (id: number) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(6); } catch {}
    }
    set({ toasts: toasts.filter((t) => t.id !== id) });
  };
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast toast--item"
          role="status"
          onClick={() => dismiss(t.id)}
          title="Tap to dismiss"
          style={{ cursor: 'pointer' }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
