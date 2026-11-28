import { useCallback, useEffect, useRef, useState } from 'react';
import { BotAvatarFor } from '../../avatar/BotAvatar';
import { useConfigUI } from '../../configStore';
import { api } from '../../lib/api';
import {
  buildCreateGroupPayload,
  eligibleGroupBots,
  isAllEligiblePicked,
  MIN_GROUP_MEMBERS,
  reconcilePickedBotIds,
  shouldBlurNameOnEnter,
  togglePickedBotId,
} from '../../lib/groupCreate';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { Modal } from './Modal';

/** New multi-operator war room: a name plus at least two Operators. */
export function CreateGroupModal() {
  const setModal = useStore((s) => s.setModal);
  const allBots = useStore((s) => s.bots);
  const bots = eligibleGroupBots(allBots);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyTouchStartYRef = useRef<number | null>(null);
  const close = useCallback(() => setModal(null), [setModal]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const selectedIds = reconcilePickedBotIds(picked, bots);
  const payload = buildCreateGroupPayload(name, picked, bots);
  const canCreate = payload !== null && !busy;
  const allPicked = isAllEligiblePicked(picked, bots);
  const blurInputOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900 && document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur();
    }
  };
  const toggle = (id: string) => {
    if (busy) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    blurInputOnMobile();
    if (error) setError(null);
    setPicked((p) => togglePickedBotId(p, id, bots));
  };

  const create = async () => {
    if (!payload || busy) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
    blurInputOnMobile();
    setBusy(true); setError(null);
    try {
      const { id } = await api.createRoom(payload.name, payload.botIds);
      const refreshed = await api.bots().catch(() => null);
      const st = useStore.getState();
      if (refreshed) st.set({ bots: refreshed.bots });
      if (mountedRef.current) {
        useConfigUI.getState().setView('chat');
        st.selectBot(id);
        close();
      }
    } catch (e) {
      if (mountedRef.current) {
        setError((e as Error).message);
        setBusy(false);
      }
    }
  };

  return (
    <Modal onClose={close} className="create-modal" label="New Multi-Operator War Room">
      <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div className="modal__header">
          <div className="modal__title">New Multi-Operator War Room</div>
          <button
            type="button"
            className="modal__close"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              close();
            }}
            aria-label="Close"
          >
            <Icon name="close" size={14} opacity={0.68} />
          </button>
        </div>
        <div
          ref={bodyRef}
          className="create-modal__body"
          style={{ alignItems: 'stretch' }}
          onTouchStart={(e) => { bodyTouchStartYRef.current = e.touches.length === 1 ? (e.touches[0]?.clientY ?? null) : null; }}
          onTouchMove={(e) => {
            if (bodyTouchStartYRef.current === null || window.innerWidth > 900) return;
            if (e.touches.length !== 1 || !e.touches[0]) {
              bodyTouchStartYRef.current = null;
              return;
            }
            const y = e.touches[0].clientY;
            if (Math.abs(y - bodyTouchStartYRef.current) > 18) {
              bodyTouchStartYRef.current = null;
              const active = document.activeElement;
              if (active instanceof HTMLElement && bodyRef.current?.contains(active) && active.tagName === 'INPUT') {
                active.blur();
              }
            }
          }}
          onTouchEnd={() => { bodyTouchStartYRef.current = null; }}
          onTouchCancel={() => { bodyTouchStartYRef.current = null; }}
        >
          <input
            className="text-input create-modal__name"
            enterKeyHint={selectedIds.length >= MIN_GROUP_MEMBERS ? 'done' : 'next'}
            autoCapitalize="words"
            maxLength={60}
            disabled={busy}
            placeholder="War room name (e.g. Product Launch, Security Triage)"
            value={name}
            onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
            onKeyDown={(e) => {
              if (shouldBlurNameOnEnter({ key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, window.innerWidth, selectedIds.length)) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            autoFocus={typeof window === 'undefined' || window.innerWidth > 900}
            aria-label="War room name"
          />
          <div className="section-label section-label--row" style={{ marginTop: 14 }}>
            <span>Select at least {MIN_GROUP_MEMBERS} Operators ({selectedIds.length} selected)</span>
            {bots.length >= MIN_GROUP_MEMBERS && (
              <button
                type="button"
                className="link-btn link-btn--small"
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                  blurInputOnMobile();
                  if (error) setError(null);
                  setPicked(allPicked ? [] : bots.map((b) => b.id));
                }}
              >
                {allPicked ? 'Clear' : 'Select all'}
              </button>
            )}
          </div>
          {bots.length < MIN_GROUP_MEMBERS && (
            <div className="empty-state" style={{ padding: '12px 0', textAlign: 'left' }}>
              You need at least {MIN_GROUP_MEMBERS} operators to start a war room.{' '}
              <button
                type="button"
                className="link-btn link-btn--small"
                disabled={busy}
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                  setModal('create');
                }}
              >
                Create an Operator
              </button>
            </div>
          )}
          <div className="group-pick">
            {bots.map((b) => (
              <button
                key={b.id}
                type="button"
                role="checkbox"
                aria-checked={selectedIds.includes(b.id)}
                disabled={busy}
                className={`group-pick__opt${selectedIds.includes(b.id) ? ' is-active' : ''}`}
                onClick={() => toggle(b.id)}
              >
                <BotAvatarFor bot={b} size={24} />
                <span className="group-pick__name">{b.name}{b.label ? ` · ${b.label}` : ''}</span>
                {selectedIds.includes(b.id) && <Icon name="check" size={12} opacity={0.8} />}
              </button>
            ))}
          </div>
          {error && <div className="card__error" role="alert">{error}</div>}
        </div>
        <div className="modal__footer">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              close();
            }}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={!canCreate}>{busy ? 'Creating…' : 'Create War Room'}</button>
        </div>
      </form>
    </Modal>
  );
}
