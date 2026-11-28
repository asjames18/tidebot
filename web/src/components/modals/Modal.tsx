import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  MODAL_AUTOFOCUS_SELECTOR,
  MODAL_FOCUSABLE_SELECTOR,
  initialModalControlSelector,
  nextModalTabTarget,
  pickInitialModalFocus,
  sheetSwipeDeltaY,
  shouldDismissOnEscape,
} from '../../lib/modalFocus';

/** 50% black scrim + centered dialog. Escape and scrim click close. Focus is trapped inside and restored on close. */
export function Modal({ onClose, children, className, label, top }: { onClose: () => void; children: ReactNode; className?: string; label: string; top?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const dragLocked = useRef<boolean | null>(null);
  const closedRef = useRef(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const safeClose = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  };

  const blurActiveOnMobile = () => {
    if (window.innerWidth <= 900) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) {
        ae.blur();
      }
    }
  };

  const onSheetTouchStart = (e: React.TouchEvent) => {
    if (window.innerWidth > 900 || e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.sheet-handle-wrap, .modal__header, .apps-modal__titlerow, .search-modal__field')) return;
    if (target.closest('input, textarea, select, button, a')) return;
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    dragLocked.current = target.closest('.sheet-handle-wrap') ? true : null;
    if (dragLocked.current) {
      blurActiveOnMobile();
      setDragging(true);
    }
  };

  const onSheetTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null || touchStartX.current === null) return;
    if (e.touches.length !== 1 || !e.touches[0]) {
      onSheetTouchCancel();
      return;
    }
    const dy = e.touches[0].clientY - touchStartY.current;
    const dx = e.touches[0].clientX - touchStartX.current;
    if (dragLocked.current === null) {
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
      if (dy > 0 && dy > Math.abs(dx) * 1.2) {
        dragLocked.current = true;
        blurActiveOnMobile();
        setDragging(true);
      } else {
        touchStartY.current = null;
        touchStartX.current = null;
        return;
      }
    }
    if (dragLocked.current) {
      setDragY(Math.max(0, dy));
    }
  };

  const onSheetTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const wasLocked = dragLocked.current === true;
    const deltaY = sheetSwipeDeltaY(e.changedTouches, touchStartY.current);
    touchStartY.current = null;
    touchStartX.current = null;
    dragLocked.current = null;
    setDragging(false);
    if (wasLocked && deltaY !== null && deltaY > 56) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(8); } catch {}
      }
      safeClose();
    } else {
      setDragY(0);
    }
  };

  const onSheetTouchCancel = () => {
    touchStartY.current = null;
    touchStartX.current = null;
    dragLocked.current = null;
    setDragging(false);
    setDragY(0);
  };

  const handleScrim = () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch {}
    }
    blurActiveOnMobile();
    safeClose();
  };

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const visible = (el: HTMLElement) => el.offsetParent !== null || el === document.activeElement;
    const k = (e: KeyboardEvent) => {
      if (shouldDismissOnEscape(e)) { e.preventDefault(); safeClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)].filter(visible);
      const active = document.activeElement as HTMLElement | null;
      const target = nextModalTabTarget(ref.current, els, active, e.shiftKey, ref.current.contains(active));
      if (target) { e.preventDefault(); target.focus(); }
    };
    window.addEventListener('keydown', k);
    const t = setTimeout(() => {
      const dialog = ref.current;
      if (!dialog) return;
      if (document.activeElement && document.activeElement !== dialog && dialog.contains(document.activeElement)) return;
      const mobile = window.innerWidth <= 900;
      const isVisible = (el: HTMLElement) => el.offsetParent !== null;
      const autofocused = [...dialog.querySelectorAll<HTMLElement>(MODAL_AUTOFOCUS_SELECTOR)].filter(isVisible);
      const preferred = [...dialog.querySelectorAll<HTMLElement>(initialModalControlSelector(mobile))].filter(isVisible);
      const focusables = [...dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)].filter(isVisible);
      pickInitialModalFocus(dialog, autofocused, preferred, focusables).focus();
    });
    return () => {
      window.removeEventListener('keydown', k);
      clearTimeout(t);
      const isMobileInput = window.innerWidth <= 900 && prev && (prev.tagName === 'INPUT' || prev.tagName === 'TEXTAREA' || prev.tagName === 'SELECT');
      if (!isMobileInput && prev?.isConnected) prev.focus?.();
    };
  }, []);
  return createPortal(
    <div className="modal-root">
      <div className="modal-scrim" onClick={(e) => { e.stopPropagation(); handleScrim(); }} />
      <div
        ref={ref}
        className={`modal ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onTouchStart={onSheetTouchStart}
        onTouchMove={onSheetTouchMove}
        onTouchEnd={onSheetTouchEnd}
        onTouchCancel={onSheetTouchCancel}
        style={{
          ...(top !== undefined ? { marginTop: top } : undefined),
          ...(dragY > 0 ? { transform: `translate3d(0, ${dragY}px, 0)`, transition: dragging ? 'none' : 'transform 180ms ease-out' } : undefined),
        }}
      >
        <div className="sheet-handle-wrap" aria-hidden="true" style={{ touchAction: 'none' }}>
          <div className="sheet-handle" />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
