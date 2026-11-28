import { useCallback, useEffect, useRef, useState } from 'react';
import type RFBType from '@novnc/novnc';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { api } from '../lib/api';
import { botVars } from '../lib/colors';
import {
  buildScreenSocketUrl,
  endTopSwipe,
  IDLE_TOP_SWIPE,
  moveTopSwipe,
  shouldClearWaking,
  shouldCloseViewerOnKey,
  startTopSwipe,
  type TopSwipeState,
  type ViewerMode,
} from '../lib/computerViewer';
import { useSelectedBot, useStore } from '../store';
import { computerStatusText } from './DetailsPanel';
import { Icon } from './Icon';

type Conn = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Fullscreen computer stage: noVNC over our relay. Watch mode is view-only; Take control reconnects with mode=control. */
export function ComputerViewer() {
  const bot = useSelectedBot();
  const computer = useStore((s) => s.computer);
  const set = useStore((s) => s.set);
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFBType | null>(null);
  const mountedRef = useRef(true);
  const swipeRef = useRef<TopSwipeState>(IDLE_TOP_SWIPE);
  const [mode, setMode] = useState<ViewerMode>('watch');
  const [conn, setConn] = useState<Conn>('connecting');
  const [attempt, setAttempt] = useState(0);
  const [waking, setWaking] = useState(false);
  const [dragY, setDragY] = useState(0);
  const running = computer?.status === 'running';
  const busy = computer?.status === 'starting' || computer?.status === 'resuming' || computer?.status === 'creating';

  const blurMobileKeyboard = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'CANVAS')) {
        ae.blur();
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    blurMobileKeyboard();
  }, [blurMobileKeyboard]);

  useEffect(() => {
    if (shouldClearWaking(computer)) setWaking(false);
  }, [computer]);

  useEffect(() => {
    setMode('watch');
    swipeRef.current = IDLE_TOP_SWIPE;
    setDragY(0);
  }, [bot?.id]);

  useEffect(() => {
    if (mode !== 'watch') {
      swipeRef.current = IDLE_TOP_SWIPE;
      setDragY(0);
    }
  }, [mode]);

  // Mobile resume: automatically reconnect noVNC when returning from background sleep.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && running && (conn === 'disconnected' || conn === 'error')) {
        setAttempt((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [running, conn]);

  const close = useCallback(() => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    blurMobileKeyboard();
    swipeRef.current = IDLE_TOP_SWIPE;
    setDragY(0);
    set({ viewerOpen: false });
  }, [blurMobileKeyboard, set]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // In control mode Escape belongs to the remote desktop.
      if (shouldCloseViewerOnKey(e, mode)) { e.preventDefault(); close(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mode, close]);

  useEffect(() => {
    const container = screenRef.current;
    if (!bot || !running || !container) return;
    let disposed = false;
    let rfb: RFBType | null = null;
    setConn('connecting');
    (async () => {
      const { default: RFB } = await import('@novnc/novnc');
      if (disposed || !container.isConnected) return;
      const url = buildScreenSocketUrl(location.protocol, location.host, bot.id, mode);
      rfb = new RFB(container, url, { shared: true });
      rfb.viewOnly = mode === 'watch';
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.background = 'transparent';
      rfb.focusOnClick = mode === 'control';
      rfb.addEventListener('connect', () => { if (!disposed) { setConn('connected'); if (mode === 'control') rfb?.focus(); } });
      rfb.addEventListener('disconnect', (e) => { if (!disposed) setConn((e as CustomEvent<{ clean: boolean }>).detail?.clean ? 'disconnected' : 'error'); });
      rfb.addEventListener('securityfailure', () => { if (!disposed) setConn('error'); });
      rfbRef.current = rfb;
    })().catch(() => { if (!disposed) setConn('error'); });
    return () => {
      disposed = true;
      try { rfb?.disconnect(); } catch { /* already closed */ }
      rfbRef.current = null;
      container.innerHTML = '';
    };
  }, [bot?.id, running, mode, attempt]);

  if (!bot) return null;

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${bot.name}'s computer`}
      style={{
        ...botVars(bot.avatarColor),
        ...(dragY > 0 ? { transform: `translate3d(0, ${dragY}px, 0)`, transition: 'none' } : undefined),
      }}
    >
      <div
        className="viewer__scrim"
        onClick={mode === 'watch' ? (e) => { e.stopPropagation(); close(); } : undefined}
      />
      <div
        className="viewer__top"
        style={mode === 'watch' ? { touchAction: 'none' } : undefined}
        onTouchStart={(e) => {
          if (mode !== 'watch' || window.innerWidth > 900 || e.touches.length !== 1 || !e.touches[0]) return;
          if ((e.target as HTMLElement | null)?.closest('button')) return;
          swipeRef.current = startTopSwipe(e.touches[0].clientX, e.touches[0].clientY);
        }}
        onTouchMove={(e) => {
          if (!swipeRef.current.active) return;
          if (e.touches.length !== 1 || !e.touches[0]) {
            swipeRef.current = IDLE_TOP_SWIPE;
            setDragY(0);
            return;
          }
          const next = moveTopSwipe(swipeRef.current, e.touches[0].clientX, e.touches[0].clientY);
          swipeRef.current = next;
          setDragY(next.dragY);
        }}
        onTouchEnd={() => {
          if (!swipeRef.current.active) return;
          const { shouldClose, next } = endTopSwipe(swipeRef.current);
          swipeRef.current = next;
          if (shouldClose) close();
          else setDragY(0);
        }}
        onTouchCancel={() => {
          swipeRef.current = IDLE_TOP_SWIPE;
          setDragY(0);
        }}
      >
        <div className="viewer__title">
          <BotAvatarFor bot={bot} size={24} />
          <span>{bot.name}'s computer</span>
          <span className="viewer__status" aria-live="polite">{computerStatusText(computer)}</span>
        </div>
        <button type="button" className="viewer__close" onClick={close} aria-label="Close computer"><Icon name="close" color="#FFFFFF" /></button>
      </div>

      <div className="viewer__stage">
        {running ? (
          <>
            <div ref={screenRef} className={`viewer__screen${mode === 'control' ? ' is-control' : ''}`} />
            {conn !== 'connected' && (
              <div className="viewer__overlay" role={conn === 'connecting' ? 'status' : 'alert'}>
                {conn === 'connecting' ? 'Connecting to the screen…' : (
                  <>
                    <span>{conn === 'error' ? 'Couldn’t reach the screen.' : 'Disconnected.'}</span>
                    <button
                      type="button"
                      className="btn btn--light"
                      onClick={() => {
                        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
                        setAttempt((n) => n + 1);
                      }}
                    >
                      Reconnect
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="viewer__overlay viewer__overlay--asleep">
            <span className="viewer__sleep-face"><i /><i /></span>
            <span>{busy ? computerStatusText(computer) : 'The computer is asleep.'}</span>
            {!busy && (
              <button
                type="button"
                className="btn btn--light"
                disabled={waking}
                onClick={() => {
                  if (waking) return;
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
                  setWaking(true);
                  api.ensureComputer().catch(() => {
                    if (mountedRef.current) setWaking(false);
                    useStore.getState().notify('Could not wake computer — check connection');
                  });
                }}
              >
                {waking ? 'Waking…' : 'Wake computer'}
              </button>
            )}
            {computer?.error && <span className="viewer__err" role="alert">{computer.error}</span>}
          </div>
        )}
      </div>

      {running && (
        <div className={`viewer__bar${mode === 'control' ? ' is-control' : ''}`}>
          {mode === 'watch' ? (
            <>
              <span className="viewer__bar-text"><b>Watching</b> · Take control to use the mouse and keyboard</span>
              <button
                type="button"
                className="btn btn--light"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
                  setMode('control');
                }}
              >
                Take control
              </button>
            </>
          ) : (
            <>
              <span className="viewer__bar-text"><span className="viewer__live-dot" /> <b>You're in control</b></span>
              <button
                type="button"
                className="btn btn--light"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
                  try { rfbRef.current?.blur(); } catch {}
                  blurMobileKeyboard();
                  setMode('watch');
                }}
              >
                I'm done
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
