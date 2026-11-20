import { useCallback, useEffect, useState } from 'react';
import type { Bot } from '@shared/types';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { api, type RoomMember } from '../lib/api';
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

  useEffect(() => {
    if (!confirmRemoveId) return;
    const t = setTimeout(() => setConfirmRemoveId(null), 3500);
    return () => clearTimeout(t);
  }, [confirmRemoveId]);

  const load = useCallback(() => {
    api.roomMembers(room.id).then((r) => setMembers(r.members)).catch((e) => setError((e as Error).message));
  }, [room.id]);
  useEffect(load, [load]);

  const save = async (ids: string[]) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try { await api.setRoomMembers(room.id, ids); load(); } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const ids = members?.map((m) => m.id) ?? [];
  const candidates = bots.filter((b) => b.kind !== 'room' && !ids.includes(b.id));

  return (
    <div className="panel-card members">
      {members === null ? <div className="panel-empty">Loading…</div> : members.length === 0 ? (
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
                save(ids.filter((x) => x !== m.id));
              }}
              disabled={saving || ids.length <= 2}
            >
              {confirmRemoveId === m.id ? 'Remove?' : <Icon name="close" size={10} opacity={0.56} />}
            </button>
          </div>
        );
      })}
      {adding ? (
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
                save([...ids, b.id]);
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
          disabled={saving}
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
      {error && <div className="card__error">{error}</div>}
      <div className="members__hint">@mention a Bot to ask just them; otherwise the group answers.</div>
    </div>
  );
}
