import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bot } from '@shared/types';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { api, type RoomMember } from '../lib/api';
import {
  addRoomMemberIds,
  eligibleRoomCandidates,
  MIN_ROOM_MEMBERS,
  removeRoomMemberIds,
  RoomMembersGate,
} from '../lib/roomMembers';
import { useStore } from '../store';
import { Icon } from './Icon';

/** Members of a group chat, with add/remove. Shown in the details panel for rooms. */
export function MembersCard({ room }: { room: Bot }) {
  const bots = useStore((s) => s.bots);
  const [members, setMembers] = useState<RoomMember[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const gateRef = useRef(new RoomMembersGate());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      gateRef.current.invalidate();
    };
  }, []);

  useEffect(() => {
    if (!confirmRemoveId) return;
    const t = setTimeout(() => setConfirmRemoveId(null), 3500);
    return () => clearTimeout(t);
  }, [confirmRemoveId]);

  const loadMembers = useCallback(async (roomId: string) => {
    const token = gateRef.current.beginLoad(roomId);
    if (!token) return;
    setError(null);
    try {
      const r = await api.roomMembers(roomId);
      if (mountedRef.current && gateRef.current.isLoadCurrent(token)) {
        setMembers(r.members);
      }
    } catch (e) {
      if (mountedRef.current && gateRef.current.isLoadCurrent(token)) {
        setError((e as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    gateRef.current.selectRoom(room.id);
    setMembers(null);
    setAdding(false);
    setSaving(false);
    setConfirmRemoveId(null);
    setError(null);
    void loadMembers(room.id);
    return () => { gateRef.current.invalidate(); };
  }, [room.id, loadMembers]);

  const save = async (nextIds: string[] | null) => {
    if (saving || !nextIds) return;
    const roomId = room.id;
    const token = gateRef.current.beginSave(roomId);
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      await api.setRoomMembers(roomId, nextIds);
      if (!mountedRef.current || !gateRef.current.isSaveCurrent(token)) return;
      await loadMembers(roomId);
    } catch (e) {
      if (mountedRef.current && gateRef.current.isSaveCurrent(token)) {
        setError((e as Error).message);
      }
    } finally {
      if (mountedRef.current && gateRef.current.isSaveCurrent(token)) {
        setSaving(false);
      }
    }
  };

  const uniqueMemberCount = members ? new Set(members.map((m) => m.id)).size : 0;
  const candidates = eligibleRoomCandidates(bots, members);

  return (
    <div className="panel-card members">
      {members === null ? (
        error ? (
          <div className="panel-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span>Could not load members.</span>
            <button
              type="button"
              className="cfg-btn cfg-btn--secondary"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                void loadMembers(room.id);
              }}
            >
              Retry
            </button>
          </div>
        ) : <div className="panel-empty">Loading…</div>
      ) : members.length === 0 ? (
        <div className="panel-empty">No Bots in this group yet.</div>
      ) : members.map((m) => {
        const bot = bots.find((b) => b.id === m.id);
        return (
          <div key={m.id} className="panel-row members__row">
            {bot ? <BotAvatarFor bot={bot} size={24} /> : <span className="members__dot" />}
            <span className="members__text">
              <span className="members__name">{m.name}</span>
              {m.label && <span className="members__label">{m.label}</span>}
            </span>
            <button
              type="button"
              className={confirmRemoveId === m.id ? 'cfg-btn cfg-btn--danger' : 'icon-btn members__remove'}
              aria-label={confirmRemoveId === m.id ? `Confirm remove ${m.name}` : `Remove ${m.name}`}
              title={confirmRemoveId === m.id ? 'Tap again to remove' : `Remove ${m.name}`}
              onClick={() => {
                if (confirmRemoveId !== m.id) {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(8); } catch {}
                  }
                  setConfirmRemoveId(m.id);
                  return;
                }
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                  try { navigator.vibrate(12); } catch {}
                }
                setConfirmRemoveId(null);
                void save(removeRoomMemberIds(members, m.id));
              }}
              disabled={saving || uniqueMemberCount <= MIN_ROOM_MEMBERS}
            >
              {confirmRemoveId === m.id ? 'Remove?' : <Icon name="close" size={10} opacity={0.56} />}
            </button>
          </div>
        );
      })}
      {adding && members !== null ? (
        <div className="members__add">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-tertiary)' }}>Choose an Operator</span>
            <button
              type="button"
              className="link-btn link-btn--small"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch {} }
                setAdding(false);
              }}
            >
              Cancel
            </button>
          </div>
          {candidates.length ? candidates.map((b) => (
            <button
              key={b.id}
              type="button"
              className="panel-row panel-row--link"
              disabled={saving}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                  try { navigator.vibrate(10); } catch {}
                }
                setAdding(false);
                void save(addRoomMemberIds(members, b.id));
              }}
            >
              <BotAvatarFor bot={b} size={20} />
              <span className="panel-row__title" style={{ flex: 1 }}>{b.name}</span>
            </button>
          )) : <div className="panel-empty">Every Bot is already here.</div>}
        </div>
      ) : (
        <button
          type="button"
          className="panel-row panel-row--action"
          disabled={saving || members === null}
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try { navigator.vibrate(8); } catch {}
            }
            setAdding(true);
          }}
        >
          <Icon name="plus" size={12} opacity={0.56} /> {saving ? 'Updating…' : 'Add a Bot'}
        </button>
      )}
      {error && <div className="card__error" role="alert">{error}</div>}
      <div className="members__hint">@mention a Bot to ask just them; otherwise the group answers.</div>
    </div>
  );
}
