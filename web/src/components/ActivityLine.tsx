import { useEffect, useRef, useState } from 'react';
import type { Bot, LiveState, Row } from '@shared/types';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { useConfigUI } from '../configStore';
import { deriveActivityLineState } from '../lib/activityLine';
import { api } from '../lib/api';
import { activityPhrase } from '../lib/phrases';
import { elapsed } from '../lib/time';
import { useStore } from '../store';

/** The single live "activity line": avatar mark + shimmering phrase + model tag + elapsed time + quick stop. */
export function ActivityLine({ bot, live, rows }: { bot: Bot; live: LiveState; rows: Row[] }) {
  const [now, setNow] = useState(Date.now());
  const [stopping, setStopping] = useState(false);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const mountedRef = useRef(true);
  const activeBotIdRef = useRef(bot.id);
  const stopGenRef = useRef(0);
  activeBotIdRef.current = bot.id;

  const { waiting, awaitingReason, shortModel, elapsedMs, tick } = deriveActivityLineState(
    bot,
    live,
    llmConfig?.defaultModel,
    now,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopGenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (waiting) return;
    setNow(Date.now());
    const t = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    const onVis = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [waiting]);

  useEffect(() => {
    stopGenRef.current += 1;
    setStopping(false);
  }, [bot.id]);

  useEffect(() => {
    if (!live.isRunning) {
      stopGenRef.current += 1;
      setStopping(false);
    }
  }, [live.isRunning]);

  const phrase = activityPhrase(live, rows, tick);

  return (
    <div className={`activity-line${waiting ? ' is-waiting' : ''}`} role="status" aria-live="polite">
      <span className="activity-line__mark"><BotAvatarFor bot={bot} size={20} /></span>
      <span className="activity-line__text shimmer" key={phrase}>{phrase}</span>
      {shortModel && !waiting && (
        <span className="activity-line__model">
          · {shortModel}
        </span>
      )}
      {!waiting && elapsedMs >= 1000 && <span className="activity-line__time">· {elapsed(elapsedMs)}</span>}
      {waiting && awaitingReason && <span className="activity-line__time">· {awaitingReason}</span>}
      {!waiting && live.isRunning && (
        <button
          type="button"
          className="bubble__copy-btn"
          style={{ marginLeft: 6 }}
          disabled={stopping}
          onClick={() => {
            if (stopping) return;
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
            const targetBotId = bot.id;
            const gen = ++stopGenRef.current;
            setStopping(true);
            api.interrupt(targetBotId).catch(() => {
              if (mountedRef.current && activeBotIdRef.current === targetBotId && stopGenRef.current === gen) {
                setStopping(false);
              }
              useStore.getState().notify('Could not stop turn — check connection');
            });
          }}
          aria-label="Stop operator turn"
          title="Stop operator turn"
        >
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
      )}
    </div>
  );
}
