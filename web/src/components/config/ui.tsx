import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../../styles/config.css';
export { formatBytes, nextRunLabel, shortDate } from '../../lib/uiFormat';

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`toggle${on ? ' is-on' : ''}`}
      onClick={() => {
        if (disabled) return;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
        onChange(!on);
      }}
    >
      <span className="toggle__knob" />
    </button>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="cfg-field">
      <label className="cfg-field__label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="cfg-field__hint">{hint}</div>}
    </div>
  );
}

/** A small segmented control with optional per-option hints. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="cfg-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-active' : ''}
          onClick={() => {
            if (o.value === value) return;
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
            if (typeof window !== 'undefined' && window.innerWidth <= 900) {
              const ae = document.activeElement;
              if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) ae.blur();
            }
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Button that asks "Sure?" in place before running a destructive action. */
export function ConfirmButton({ children, confirmLabel = 'Delete', onConfirm, className = 'cfg-btn cfg-btn--ghost-danger', disabled, title, ariaLabel }: { children: ReactNode; confirmLabel?: string; onConfirm: () => Promise<unknown> | void; className?: string; disabled?: boolean; title?: string; ariaLabel?: string }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (!asking || busy) return;
    const t = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(t);
  }, [asking, busy]);
  if (!asking) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return;
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
          if (typeof window !== 'undefined' && window.innerWidth <= 900) {
            const ae = document.activeElement;
            if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) ae.blur();
          }
          setAsking(true);
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="cfg-btn cfg-btn--danger"
      disabled={busy || disabled}
      aria-label={ariaLabel ? `Confirm ${ariaLabel}` : undefined}
      onClick={async () => {
        if (busy || disabled) return;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          if (mountedRef.current) {
            setBusy(false);
            setAsking(false);
          }
        }
      }}
    >
      {busy ? 'Working…' : confirmLabel}
    </button>
  );
}
