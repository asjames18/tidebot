import { useRef, useState } from 'react';
import { useStore } from '../store';

function ToastItem({ id, text, onDismiss }: { id: number; text: string; onDismiss: (id: number) => void }) {
  const dragRef = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const dismissedRef = useRef(false);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  const dismissOnce = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss(id);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    dragRef.current = { x: t.clientX, y: t.clientY, active: false };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = dragRef.current;
    const t = e.touches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = Math.min(0, t.clientY - start.y); // allow upward flick
    if (!start.active && (Math.abs(dx) > 6 || dy < -6)) {
      start.active = true;
    }
    if (start.active) {
      setOffset({ x: dx, y: dy });
    }
  };

  const onTouchEnd = () => {
    const start = dragRef.current;
    dragRef.current = null;
    if (start?.active && offset && (Math.abs(offset.x) > 56 || offset.y < -28)) {
      setOffset(null);
      dismissOnce();
      return;
    }
    setOffset(null);
  };

  const onTouchCancel = () => {
    dragRef.current = null;
    setOffset(null);
  };

  const dragDist = offset ? Math.hypot(offset.x, offset.y) : 0;
  const opacity = offset ? Math.max(0.25, 1 - dragDist / 140) : undefined;

  return (
    <div
      className="toast toast--item"
      role="status"
      onClick={dismissOnce}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      title="Tap or swipe to dismiss"
      style={{
        cursor: 'pointer',
        pointerEvents: 'auto',
        touchAction: 'none',
        transform: offset ? `translate3d(${offset.x}px, ${offset.y}px, 0)` : undefined,
        opacity,
        transition: offset ? 'none' : 'transform 160ms var(--ease-out), opacity 160ms var(--ease-out)',
      }}
    >
      {text}
    </div>
  );
}

/** Global transient notifications (errors and confirmations), stacked top-center. Tap or swipe to dismiss immediately. */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  const dismiss = (id: number) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(6); } catch {}
    }
    useStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  };
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} text={t.text} onDismiss={dismiss} />
      ))}
    </div>
  );
}
