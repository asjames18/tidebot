import { useEffect, useState } from 'react';
import type { Bot, LiveState, Row } from '@shared/types';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { useConfigUI } from '../configStore';
import { api } from '../lib/api';
import { activityPhrase } from '../lib/phrases';
import { elapsed } from '../lib/time';

/** The single live "activity line": avatar mark + shimmering phrase + model tag + elapsed time + quick stop. */
export function ActivityLine({ bot, live, rows }: { bot: Bot; live: LiveState; rows: Row[] }) {
  const [now, setNow] = useState(Date.now());
  const llmConfig = useConfigUI((s) => s.llmConfig);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const since = live.startedAt ?? live.activity?.since ?? live.awaiting?.since ?? now;
  const tick = Math.floor((now - (live.activity?.since ?? since)) / 6000);
  const phrase = activityPhrase(live, rows, tick);
  const waiting = !live.isRunning && (live.awaiting || live.activity?.kind === 'waiting_for_you');
  const activeModel = bot.model || llmConfig?.defaultModel || '';
  const shortModel = activeModel.includes('/') ? activeModel.split('/').pop()! : activeModel;

  return (
    <div className={`activity-line${waiting ? ' is-waiting' : ''}`} role="status" aria-live="polite">
      <span className="activity-line__mark"><BotAvatarFor bot={bot} size={20} /></span>
      <span className="activity-line__text shimmer" key={phrase}>{phrase}</span>
      {shortModel && !waiting && (
        <span className="activity-line__model">
          · {shortModel}
        </span>
      )}
      {!waiting && now - since >= 1000 && <span className="activity-line__time">· {elapsed(now - since)}</span>}
      {waiting && live.awaiting?.reason && <span className="activity-line__time">· {live.awaiting.reason}</span>}
      {!waiting && live.isRunning && (
        <button
          type="button"
          className="bubble__copy-btn"
          style={{ marginLeft: 6 }}
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
            api.interrupt(bot.id).catch(() => {});
          }}
          title="Stop operator turn"
        >
          Stop
        </button>
      )}
    </div>
  );
}
