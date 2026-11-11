import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 50% black scrim + centered dialog. Escape and scrim click close. Focus is trapped inside and restored on close. */
export function Modal({ onClose, children, className, label, top }: { onClose: () => void; children: ReactNode; className?: string; label: string; top?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!ref.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k);
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus], input, textarea, button');
      el?.focus();
    });
    return () => { window.removeEventListener('keydown', k); clearTimeout(t); prev?.focus?.(); };
  }, [onClose]);
  return createPortal(
    <div className="modal-root">
      <div className="modal-scrim" onMouseDown={onClose} />
      <div ref={ref} className={`modal ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={label} style={top !== undefined ? { marginTop: top } : undefined}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
