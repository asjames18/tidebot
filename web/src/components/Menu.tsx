import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { closeMenuAndRestoreFocus, nextMenuIndex } from '../lib/menuNav';

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; hint?: string }

/** Small popover menu anchored by its parent (position: relative). Supports Arrow/Home/End navigation and closes on outside click, Tab, or Escape (restoring trigger focus). */
export function Menu({ items, onClose, align = 'left', placement = 'below', children }: { items: MenuItem[]; onClose: () => void; align?: 'left' | 'right' | 'center'; placement?: 'below' | 'above'; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Keep popover menus within viewport bounds on narrow mobile screens (including rotation / keyboard resize).
  useLayoutEffect(() => {
    const clamp = () => {
      const el = ref.current;
      if (!el) return;
      el.style.translate = '';
      const pad = 8;
      const vw = window.visualViewport?.width ?? window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      el.style.maxHeight = `${Math.max(160, Math.floor(vh - pad * 2))}px`;
      el.style.overflowY = 'auto';
      const rect = el.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (rect.right > vw - pad) dx = vw - pad - rect.right;
      if (rect.left + dx < pad) dx += pad - (rect.left + dx);
      if (rect.bottom > vh - pad) dy = vh - pad - rect.bottom;
      if (rect.top + dy < pad) dy += pad - (rect.top + dy);
      if (dx !== 0 || dy !== 0) {
        el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
      }
    };
    clamp();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', clamp);
    vv?.addEventListener('scroll', clamp);
    window.addEventListener('resize', clamp);
    return () => {
      vv?.removeEventListener('resize', clamp);
      vv?.removeEventListener('scroll', clamp);
      window.removeEventListener('resize', clamp);
    };
  }, [items.length, align, placement]);

  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const getItems = () =>
      ref.current
        ? [...ref.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')]
        : [];

    const first = getItems()[0];
    first?.focus?.({ preventScroll: true });

    const down = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenuAndRestoreFocus(() => onCloseRef.current(), prior);
        return;
      }
      if (e.key === 'Tab') {
        onCloseRef.current();
        return;
      }
      const menuItems = getItems();
      const currentIdx = menuItems.indexOf(document.activeElement as HTMLElement);
      const next = nextMenuIndex(currentIdx, menuItems.length, e.key);
      if (next !== null) {
        e.preventDefault();
        e.stopPropagation();
        menuItems[next]?.focus({ preventScroll: true });
      }
    };
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', down, { passive: true });
    });
    document.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
  return (
    <div ref={ref} className={`menu is-${align} is-${placement}`} role="menu">
      {children}
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={`menu__item${it.danger ? ' is-danger' : ''}`}
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try { navigator.vibrate(8); } catch {}
            }
            onCloseRef.current();
            it.onSelect();
          }}
        >
          <span>{it.label}</span>
          {it.hint && <span className="menu__hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}
