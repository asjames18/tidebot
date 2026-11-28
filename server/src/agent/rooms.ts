import { db, now } from '../db.js';
import { newId } from '../lib/ids.js';
import { hub } from '../lib/hub.js';
import { appendRow, emitBot } from '../store.js';

/**
 * Group chats ("rooms"; Grok Bot: GrokBotAgent kind=ROOM, member_agent_ids, server turn-taking).
 * A room is a bot row with kind='room' and a members list. It never runs its own agent loop:
 * a user message is dispatched to the members who should answer (@mentioned ones, else all,
 * capped), each member runs its normal loop with the group context and replies into the room
 * with post_to_group.
 */

const MAX_RESPONDERS = 3;

function parseMemberIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match explicit `@Name` mentions using Unicode word boundaries so `@Sammy`
 * does not falsely trigger `@Sam` and email addresses like `foo@sam.com` do
 * not trigger mentions.
 */
export function findMentionedMembers<T extends { name: string }>(text: string, members: readonly T[]): T[] {
  return members.filter((m) => {
    const name = m.name.trim();
    if (!name) return false;
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])@${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    return pattern.test(text);
  });
}

export function initRooms() {
  for (const col of ["kind TEXT NOT NULL DEFAULT 'agent'", 'members TEXT']) {
    try { db.exec(`ALTER TABLE bots ADD COLUMN ${col}`); } catch { /* exists */ }
  }
}

export const isRoom = (botId: string) => (db.prepare('SELECT kind FROM bots WHERE id=?').get(botId) as any)?.kind === 'room';

export function roomMembers(roomId: string): { id: string; name: string }[] {
  const r = db.prepare('SELECT members FROM bots WHERE id=?').get(roomId) as any;
  const ids = parseMemberIds(r?.members);
  return ids.map((id) => db.prepare('SELECT id, name FROM bots WHERE id=?').get(id) as any).filter(Boolean);
}

export function createRoom(userId: string, name: string, memberIds: string[]) {
  const id = newId('room');
  db.prepare(
    `INSERT INTO bots(id,user_id,name,label,description,avatar_shape,avatar_color,kind,members,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'room',?,?,?)`,
  ).run(id, userId, name.slice(0, 60), 'Group', `Group chat with ${memberIds.length} Bots`, 'cloud', 'gray', JSON.stringify(memberIds), now(), now());
  hub.emit(userId, { type: 'roster' });
  return id;
}

/** Called instead of the agent loop when the user posts in a room. */
export function dispatchRoomMessage(roomId: string, text: string, enqueue: (botId: string, t: any) => void) {
  const room = db.prepare('SELECT * FROM bots WHERE id=?').get(roomId) as any;
  if (!room) return;
  const members = roomMembers(roomId);
  if (!members.length) {
    appendRow(roomId, 'notice', { type: 'notice', text: 'This group has no Bots yet.', tone: 'warn' });
    return;
  }
  const mentioned = findMentionedMembers(text, members);
  const responders = (mentioned.length ? mentioned : members).slice(0, MAX_RESPONDERS);
  const recent = (db.prepare("SELECT body FROM rows WHERE bot_id=? AND generation=? AND kind='message' ORDER BY seq DESC LIMIT 12").all(roomId, room.generation) as any[])
    .reverse()
    .map((r) => {
      const b = JSON.parse(r.body);
      return `${b.from?.name ?? (b.role === 'user' ? 'User' : 'Bot')}: ${String(b.text).slice(0, 600)}`;
    })
    .join('\n');
  for (const m of responders) {
    enqueue(m.id, {
      type: 'system',
      text:
        `[Group chat "${room.name}"] Members: ${members.map((x) => x.name).join(', ')}. ` +
        `${mentioned.length ? 'You were @mentioned.' : 'The user addressed the whole group.'}\n` +
        `Recent group messages:\n${recent}\n\n` +
        `Reply to the group by calling post_to_group with group_name "${room.name}" (use your tools first if the request needs real work). ` +
        `Keep it short and don't repeat what other Bots already said. If you have nothing to add, call stay_silent. Do not write a normal reply.`,
    });
  }
}

export function postToRoom(fromBotId: string, roomName: string, text: string) {
  const from = db.prepare('SELECT id, user_id, name FROM bots WHERE id=?').get(fromBotId) as any;
  if (!from) return 'Unknown sender.';
  const targetName = String(roomName ?? '').trim();
  if (!targetName) return 'Group name is required.';
  const body = String(text ?? '').trim();
  if (!body) return 'Message text cannot be empty.';
  const room = db.prepare("SELECT * FROM bots WHERE user_id=? AND kind='room' AND lower(name)=lower(?)").get(from.user_id, targetName) as any;
  if (!room) return `No group named "${roomName}".`;
  const members = parseMemberIds(room.members);
  if (!members.includes(fromBotId)) return `You're not a member of "${room.name}".`;
  appendRow(room.id, 'message', { type: 'message', role: 'assistant', text: body, from: { kind: 'bot', id: from.id, name: from.name } });
  db.prepare('UPDATE bots SET unread = unread + 1 WHERE id=?').run(room.id);
  emitBot(room.id);
  return 'Posted to the group.';
}
