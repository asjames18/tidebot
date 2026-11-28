import type { MessageBody, Row } from '@shared/types';

export type TranscriptItem =
  | { kind: 'divider'; key: string; ts: number }
  | { kind: 'group'; key: string; side: 'left' | 'right'; from?: MessageBody['from']; rows: Row[] }
  | { kind: 'steps'; key: string; rows: Row[] }
  | { kind: 'row'; key: string; row: Row };

const DIVIDER_GAP = 60 * 60 * 1000;
const GROUP_GAP = 5 * 60 * 1000;

/**
 * Turns transcript rows into render items: date dividers, grouped bubbles,
 * collapsed tool-call steps, cards, and events.
 *
 * Empty non-streaming messages with no reasoning are skipped before emitting
 * date dividers so they never leave dangling timestamp dividers.
 */
export function buildTranscriptItems(rows: Row[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let prevTs = 0;
  for (const row of rows) {
    const b = row.body;
    if (b.type === 'message' && !b.text && !b.reasoning && !b.streaming) continue;

    if (!prevTs || row.createdAt - prevTs > DIVIDER_GAP) {
      items.push({ kind: 'divider', key: `d${row.seq}`, ts: row.createdAt });
    }
    prevTs = row.createdAt;
    const last = items[items.length - 1];

    if (b.type === 'tool-call') {
      if (last?.kind === 'steps') last.rows.push(row);
      else items.push({ kind: 'steps', key: `s${row.seq}`, rows: [row] });
      continue;
    }
    if (b.type === 'message') {
      const side = b.role === 'user' && (!b.from || b.from.kind === 'voice') ? 'right' : 'left';
      const sender = b.from ? `${b.from.kind}:${b.from.id}` : b.role;
      const lastRow = last?.kind === 'group' ? last.rows[last.rows.length - 1] : null;
      const lastBody = lastRow?.body as MessageBody | undefined;
      const lastSender = lastBody ? (lastBody.from ? `${lastBody.from.kind}:${lastBody.from.id}` : lastBody.role) : null;
      const delta = lastRow ? row.createdAt - lastRow.createdAt : Number.POSITIVE_INFINITY;
      if (last?.kind === 'group' && lastSender === sender && delta >= 0 && delta < GROUP_GAP) {
        last.rows.push(row);
      } else {
        items.push({ kind: 'group', key: `g${row.seq}`, side, from: b.from, rows: [row] });
      }
      continue;
    }
    items.push({ kind: 'row', key: `r${row.seq}`, row });
  }
  return items;
}

export function cornerClass(i: number, n: number): string {
  if (n < 2) return '';
  if (i === 0) return ' is-first';
  if (i === n - 1) return ' is-last';
  return ' is-mid';
}

/** Convert Markdown message text into concise, surrogate-safe plain text for speechSynthesis. */
export function formatSpeechText(text: string, maxChars = 1200): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxChars) return plain;
  if (maxChars <= 0) return '';
  const code = plain.charCodeAt(maxChars - 1);
  return plain.slice(0, code >= 0xd800 && code <= 0xdbff ? maxChars - 1 : maxChars);
}
