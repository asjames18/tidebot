import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db, now } from './db.js';
import { env } from './env.js';
import { newId } from './lib/ids.js';
import { hub } from './lib/hub.js';
import { createSession, destroySession, requireUser, userFromCookieHeader, type AuthVars } from './lib/auth.js';
import { allLive, appendRow, clearConversation, describeCron, emitBot, getBot, getBotRow, getRow, listBots, listRoutines, listRows, listTasks, toRoutine, updateRow } from './store.js';
import { enqueue, interrupt, resolveApproval } from './agent/loop.js';
import { computerState, ensureComputer, refreshComputer, suspendComputer } from './computer.js';
import { orgo } from './orgo.js';
import { catalog, connectedToolkits, deleteConnection, disconnect, googleProfile, startConnect, startGoogleLogin, toolkitInfo } from './composio.js';
import { runRoutine, scheduleRoutine, unscheduleRoutine } from './routines.js';
import { deleteEventTrigger, isEventSchedule } from './triggers.js';
import { dispatchRoomMessage } from './agent/rooms.js';
import { voiceApi } from './voice.js';
import type { AvatarColor, AvatarShape, RowBody, Toolkit } from './types.js';
import { Cron } from 'croner';

export const api = new Hono<AuthVars>();

const SHAPES: AvatarShape[] = ['blob', 'pebble', 'bean', 'egg', 'squircle', 'tablet', 'capsule', 'cylinder', 'hex', 'gem', 'crystal', 'wedge', 'shield', 'dome', 'arch', 'cloud', 'teardrop', 'leaf', 'square', 'sparkle', 'clover', 'flower', 'heart', 'house', 'star'];
const COLORS: AvatarColor[] = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta', 'gray'];

function hashPick<T>(id: string, list: T[]): T {
  let h = 0x811c9dc5;
  for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return list[h % list.length];
}

function createBot(userId: string, b: { name: string; label?: string; description?: string; instructions?: string; avatarShape?: string; avatarColor?: string; mode?: string; model?: string; isPrimary?: boolean }) {
  const id = newId('bot');
  const shape = SHAPES.includes(b.avatarShape as AvatarShape) ? b.avatarShape : hashPick(id, SHAPES.slice(0, 13));
  const color = COLORS.includes(b.avatarColor as AvatarColor) ? b.avatarColor : hashPick(id, COLORS.filter((c) => c !== 'black'));
  db.prepare(
    'INSERT INTO bots(id,user_id,name,label,description,instructions,avatar_shape,avatar_color,mode,model,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, userId, b.name.trim().slice(0, 60) || 'New Bot', b.label ?? '', b.description ?? '', b.instructions ?? '', shape, color, b.mode === 'teammate' ? 'teammate' : 'personal', (b.model ?? '').trim(), b.isPrimary ? 1 : 0, now(), now());
  hub.emit(userId, { type: 'roster' });
  return getBot(id)!;
}

function findOrCreateUser(email: string, name?: string, preferId?: string) {
  const existing = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email) as any;
  if (existing) return { id: existing.id as string, isNew: false };
  const id = preferId ?? newId('usr');
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run(id, email, name ?? email.split('@')[0], now());
  createBot(id, { name: 'Quinn', label: 'Chief of Staff', description: 'Your main point of contact. Checks in proactively and coordinates work with your other Bots.', avatarShape: 'blob', avatarColor: 'black', isPrimary: true });
  return { id, isNew: true };
}

// ---------- auth ----------

api.get('/auth/me', (c) => {
  const user = userFromCookieHeader(c.req.header('cookie'));
  return c.json({ user, devLogin: env.devLogin, providers: env.providers });
});

api.get('/auth/google/start', async (c) => {
  const attemptId = newId('login');
  const provisional = newId('usr');
  const cb = `${env.serverUrl}/api/auth/google/callback?attempt=${attemptId}`;
  const { redirectUrl, connectedAccountId } = await startGoogleLogin(provisional, cb);
  db.prepare('INSERT INTO login_attempts(id,provisional_user_id,connected_account_id,created_at) VALUES (?,?,?,?)').run(attemptId, provisional, connectedAccountId ?? null, now());
  return c.redirect(redirectUrl);
});

api.get('/auth/google/callback', async (c) => {
  const attempt = db.prepare('SELECT * FROM login_attempts WHERE id=?').get(c.req.query('attempt') ?? '') as any;
  const caId = c.req.query('connected_account_id') ?? attempt?.connected_account_id;
  if (!attempt || c.req.query('status') === 'failed' || !caId) return c.redirect(`${env.appUrl}/?login=failed`);
  if (attempt.connected_account_id && caId !== attempt.connected_account_id) return c.redirect(`${env.appUrl}/?login=failed`);
  db.prepare('DELETE FROM login_attempts WHERE id=?').run(attempt.id);
  try {
    const profile = await googleProfile(caId);
    const { id, isNew } = findOrCreateUser(profile.email, profile.name, attempt.provisional_user_id);
    // Existing user: the Gmail connection made for sign-in belongs to a throwaway id; remove it.
    if (!isNew && id !== attempt.provisional_user_id) await deleteConnection(caId);
    createSession(c, id);
    return c.redirect(`${env.appUrl}/`);
  } catch (e: any) {
    console.error('[auth] google callback', e);
    return c.redirect(`${env.appUrl}/?login=failed`);
  }
});

api.post('/auth/dev', async (c) => {
  if (!env.devLogin) return c.json({ error: 'disabled' }, 403);
  const { email, name } = await c.req.json<{ email: string; name?: string }>();
  if (!email?.includes('@')) return c.json({ error: 'email required' }, 400);
  const { id } = findOrCreateUser(email, name);
  createSession(c, id);
  return c.json({ ok: true });
});

api.post('/auth/logout', (c) => { destroySession(c); return c.json({ ok: true }); });

// everything below requires a session
api.use('/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/') || c.req.path.startsWith('/api/apps/callback') || c.req.path === '/api/health') return next();
  return requireUser(c, next);
});

// ---------- events (SSE) ----------

api.get('/events', (c) => {
  const user = c.get('user');
  return streamSSE(c, async (stream) => {
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    const unsub = hub.subscribe(user.id, (ev) => { queue.push(JSON.stringify(ev)); wake?.(); });
    stream.onAbort(() => { unsub(); wake?.(); });
    await stream.writeSSE({ data: JSON.stringify({ type: 'hello', serverTime: now() }) });
    while (!stream.aborted) {
      if (!queue.length) {
        await Promise.race([new Promise<void>((r) => (wake = r)), new Promise((r) => setTimeout(r, 20_000))]);
        wake = null;
        if (!queue.length) { await stream.writeSSE({ data: JSON.stringify({ type: 'ping' }) }); continue; }
      }
      while (queue.length) await stream.writeSSE({ data: queue.shift()! });
    }
    unsub();
  });
});

// ---------- bots ----------

const ownBot = (userId: string, id: string) => {
  const b = getBotRow(id);
  return b && b.user_id === userId ? b : null;
};

api.get('/bots', (c) => c.json({ bots: listBots(c.get('user').id), live: allLive(c.get('user').id) }));

api.post('/bots', async (c) => {
  const body = await c.req.json();
  return c.json({ bot: createBot(c.get('user').id, body) });
});

api.patch('/bots/:id', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const p = await c.req.json();
  const cols: Record<string, string> = { name: 'name', label: 'label', description: 'description', instructions: 'instructions', avatarShape: 'avatar_shape', avatarColor: 'avatar_color', mode: 'mode', effort: 'effort', model: 'model', pinned: 'pinned', voice: 'voice', voiceSpeed: 'voice_speed', voiceLanguage: 'voice_language' };
  for (const [k, col] of Object.entries(cols)) {
    if (p[k] !== undefined) db.prepare(`UPDATE bots SET ${col}=?, updated_at=? WHERE id=?`).run(typeof p[k] === 'boolean' ? (p[k] ? 1 : 0) : p[k], now(), b.id);
  }
  emitBot(b.id);
  return c.json({ bot: getBot(b.id) });
});

api.delete('/bots/:id', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  for (const r of listRoutines(b.id)) unscheduleRoutine(r.id);
  db.prepare('DELETE FROM screens WHERE bot_id=?').run(b.id);
  db.prepare('DELETE FROM bots WHERE id=?').run(b.id);
  hub.emit(c.get('user').id, { type: 'roster' });
  return c.json({ ok: true });
});

api.post('/bots/:id/primary', (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  db.prepare('UPDATE bots SET is_primary = (id = ?) WHERE user_id=?').run(b.id, user.id);
  hub.emit(user.id, { type: 'roster' });
  return c.json({ ok: true });
});

api.post('/bots/:id/clone', (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const cloned = createBot(user.id, {
    name: `${b.name} Copy`,
    label: b.label,
    description: b.description,
    instructions: b.instructions,
    avatarShape: b.avatar_shape,
    avatarColor: b.avatar_color,
    mode: b.mode,
    model: b.model,
  });
  const skills = db.prepare('SELECT name, description, body FROM skills WHERE bot_id=?').all(b.id) as any[];
  for (const s of skills) {
    db.prepare('INSERT INTO skills(id,bot_id,name,description,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(newId('skl'), cloned.id, s.name, s.description ?? '', s.body, now(), now());
  }
  hub.emit(user.id, { type: 'roster' });
  return c.json({ bot: cloned });
});

api.get('/bots/:id/export', (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rows = listRows(b.id, { limit: 500 });
  const lines: string[] = [
    `# ${b.name}${b.label ? ` — ${b.label}` : ''}`,
    `Exported from TideOS on ${new Date().toISOString()}`,
    b.model ? `Model: \`${b.model}\`` : '',
    '',
    '---',
    '',
  ].filter(Boolean);
  for (const r of rows) {
    const dt = new Date(r.createdAt).toLocaleString();
    if (r.body.type === 'message') {
      const speaker = r.body.role === 'user' ? 'You' : b.name;
      lines.push(`### ${speaker} (${dt})`);
      if (r.body.reasoning) {
        lines.push(`<details><summary>Thought process</summary>\n\n${r.body.reasoning}\n</details>\n`);
      }
      lines.push(`${r.body.text}\n`);
    } else if (r.body.type === 'tool-call') {
      lines.push(`- **Tool**: \`${r.body.name}\` (${r.body.label}) — ${r.body.status}${r.body.summary ? `: ${r.body.summary}` : ''}`);
    }
  }
  const md = lines.join('\n');
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-transcript.md"`,
    },
  });
});

api.get('/system/status', async (c) => {
  const user = c.get('user');
  const botsCount = (db.prepare('SELECT COUNT(*) n FROM bots WHERE user_id=? AND COALESCE(hidden,0)=0').get(user.id) as any).n;
  const tasksOpen = (db.prepare("SELECT COUNT(*) n FROM tasks t JOIN bots b ON b.id=t.bot_id WHERE b.user_id=? AND t.state<>'done'").get(user.id) as any).n;
  const tasksDone = (db.prepare("SELECT COUNT(*) n FROM tasks t JOIN bots b ON b.id=t.bot_id WHERE b.user_id=? AND t.state='done'").get(user.id) as any).n;
  const memoriesCount = (db.prepare('SELECT COUNT(*) n FROM memories m JOIN bots b ON b.id=m.bot_id WHERE b.user_id=?').get(user.id) as any).n;
  const routinesCount = (db.prepare('SELECT COUNT(*) n FROM routines r JOIN bots b ON b.id=r.bot_id WHERE b.user_id=? AND r.enabled=1').get(user.id) as any).n;
  const connected = await connectedToolkits(user.id).catch(() => new Set<string>());
  return c.json({
    botsCount,
    tasksOpen,
    tasksDone,
    memoriesCount,
    routinesCount,
    connectedAppsCount: connected.size,
    connectedApps: [...connected],
    computer: computerState(user.id),
    serverTime: now(),
  });
});

api.post('/bots/:id/read', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  db.prepare('UPDATE bots SET unread=0 WHERE id=?').run(b.id);
  emitBot(b.id);
  return c.json({ ok: true });
});

// ---------- conversation ----------

api.get('/bots/:id/rows', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const beforeSeq = c.req.query('beforeSeq') ? Number(c.req.query('beforeSeq')) : undefined;
  return c.json({ generation: b.generation, rows: listRows(b.id, { beforeSeq, limit: Number(c.req.query('limit') ?? 200) }) });
});

api.post('/bots/:id/messages', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: 'empty' }, 400);
  const row = appendRow(b.id, 'message', { type: 'message', role: 'user', text: text.trim() });
  // Group chats dispatch to their member Bots instead of running their own loop.
  if (b.kind === 'room') dispatchRoomMessage(b.id, text.trim(), enqueue);
  // Any pending question card is answered by a free-text message.
  else enqueue(b.id, { type: 'user', text: text.trim() });
  return c.json({ row });
});

api.post('/bots/:id/interrupt', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  interrupt(b.id);
  return c.json({ ok: true });
});

api.post('/bots/:id/fresh', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  interrupt(b.id);
  clearConversation(b.id);
  emitBot(b.id);
  return c.json({ ok: true });
});

api.post('/bots/:id/retry', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  interrupt(b.id);
  const rows = listRows(b.id, { limit: 60 });
  const lastUserRow = [...rows].reverse().find((r) => r.body.type === 'message' && r.body.role === 'user');
  if (!lastUserRow || lastUserRow.body.type !== 'message') {
    return c.json({ error: 'No user message to retry' }, 400);
  }
  enqueue(b.id, { type: 'user', text: lastUserRow.body.text });
  return c.json({ ok: true });
});

api.post('/approvals/:id', async (c) => {
  const user = c.get('user');
  const approvalId = c.req.param('id');
  const { decision } = await c.req.json<{ decision: 'allow' | 'always' | 'deny' }>();
  if (approvalId.startsWith('drf_')) {
    const raw = db.prepare("SELECT r.* FROM rows r JOIN bots b ON b.id=r.bot_id WHERE b.user_id=? AND r.kind='card' AND r.body LIKE ?").get(user.id, `%${approvalId}%`) as any;
    if (raw) {
      const body = JSON.parse(raw.body) as RowBody;
      if (body.type === 'card' && body.card === 'draft') {
        const nextStatus = decision === 'deny' ? 'discarded' : 'sent';
        updateRow(raw.bot_id, raw.seq, { ...body, status: nextStatus });
        if (nextStatus === 'sent') {
          enqueue(raw.bot_id, { type: 'user', text: `[Approved draft ${body.channel} to ${body.to}${body.subject ? ` ("${body.subject}")` : ''}]: Please proceed with sending or finalizing it.` });
        }
        return c.json({ ok: true });
      }
    }
  }
  try { resolveApproval(user.id, approvalId, decision); } catch { return c.json({ error: 'not found' }, 404); }
  return c.json({ ok: true });
});

api.post('/bots/:id/cards/:seq/answer', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const row = getRow(b.id, Number(c.req.param('seq')));
  const { answer } = await c.req.json<{ answer: string }>();
  if (!row || row.body.type !== 'card' || row.body.card !== 'question') return c.json({ error: 'not a question' }, 400);
  updateRow(b.id, row.seq, { ...row.body, status: 'answered', answer });
  appendRow(b.id, 'message', { type: 'message', role: 'user', text: answer });
  enqueue(b.id, { type: 'user', text: `[Answer to "${row.body.question}"] ${answer}` });
  return c.json({ ok: true });
});

api.post('/bots/:id/cards/:seq/dismiss', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const row = getRow(b.id, Number(c.req.param('seq')));
  if (!row || row.body.type !== 'card') return c.json({ error: 'not a card' }, 400);
  const body: any = { ...row.body, status: row.body.card === 'connect' ? 'skipped' : 'dismissed' };
  updateRow(b.id, row.seq, body);
  if (row.body.card === 'connect') enqueue(b.id, { type: 'system', text: `The user skipped connecting ${row.body.toolkitName}. Continue without it.` });
  return c.json({ ok: true });
});

// ---------- routines / tasks / memories ----------

api.get('/bots/:id/routines', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json({ routines: listRoutines(b.id) }) : c.json({ error: 'not found' }, 404);
});

api.post('/bots/:id/routines', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ name?: string; prompt?: string; schedule?: string; timezone?: string }>().catch(() => ({} as any));
  const name = String(body.name ?? '').trim().slice(0, 80);
  const prompt = String(body.prompt ?? '').trim().slice(0, 8000);
  const schedule = String(body.schedule ?? '').trim();
  const timezone = String(body.timezone ?? 'UTC').trim() || 'UTC';
  if (!name || !prompt || !schedule) return c.json({ error: 'Name, prompt, and schedule are required' }, 400);
  try {
    new Cron(schedule, { paused: true, timezone });
  } catch (e: any) {
    return c.json({ error: `Invalid cron schedule: ${e?.message ?? e}` }, 400);
  }
  const id = newId('rt');
  db.prepare('INSERT INTO routines(id,bot_id,name,prompt,schedule,timezone,enabled,created_at) VALUES (?,?,?,?,?,?,1,?)')
    .run(id, b.id, name, prompt, schedule, timezone, now());
  const r = toRoutine(db.prepare('SELECT * FROM routines WHERE id=?').get(id));
  scheduleRoutine(r);
  appendRow(b.id, 'event', { type: 'event', event: 'routine-created', text: `Routine created: ${name} · ${describeCron(schedule)}`, ref: id });
  hub.emit(user.id, { type: 'routines', botId: b.id });
  return c.json({ routine: r });
});

api.patch('/routines/:id', async (c) => {
  const r = db.prepare('SELECT r.* FROM routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.user_id=?').get(c.req.param('id'), c.get('user').id) as any;
  if (!r) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ name?: string; prompt?: string; schedule?: string; timezone?: string; enabled?: boolean }>();
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) || r.name : r.name;
  const prompt = body.prompt !== undefined ? String(body.prompt).trim().slice(0, 8000) || r.prompt : r.prompt;
  const schedule = body.schedule !== undefined ? String(body.schedule).trim() || r.schedule : r.schedule;
  const timezone = body.timezone !== undefined ? String(body.timezone).trim() || r.timezone : r.timezone;
  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : r.enabled;
  if (!isEventSchedule(schedule)) {
    try {
      new Cron(schedule, { paused: true, timezone });
    } catch (e: any) {
      return c.json({ error: `Invalid cron schedule: ${e?.message ?? e}` }, 400);
    }
  }
  db.prepare('UPDATE routines SET name=?, prompt=?, schedule=?, timezone=?, enabled=? WHERE id=?')
    .run(name, prompt, schedule, timezone, enabled, r.id);
  const next = toRoutine(db.prepare('SELECT * FROM routines WHERE id=?').get(r.id));
  next.enabled ? scheduleRoutine(next) : unscheduleRoutine(r.id);
  hub.emit(c.get('user').id, { type: 'routines', botId: r.bot_id });
  return c.json({ routine: next });
});

api.post('/routines/:id/run', (c) => {
  const r = db.prepare('SELECT r.* FROM routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.user_id=?').get(c.req.param('id'), c.get('user').id) as any;
  if (!r) return c.json({ error: 'not found' }, 404);
  runRoutine(r.id);
  return c.json({ ok: true });
});

api.delete('/routines/:id', async (c) => {
  const r = db.prepare('SELECT r.* FROM routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.user_id=?').get(c.req.param('id'), c.get('user').id) as any;
  if (!r) return c.json({ error: 'not found' }, 404);
  unscheduleRoutine(r.id);
  await deleteEventTrigger(r.id);
  db.prepare('DELETE FROM routines WHERE id=?').run(r.id);
  hub.emit(c.get('user').id, { type: 'routines', botId: r.bot_id });
  return c.json({ ok: true });
});

api.get('/bots/:id/tasks', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json({ tasks: listTasks(b.id) }) : c.json({ error: 'not found' }, 404);
});

api.post('/bots/:id/tasks', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const { title, note } = await c.req.json<{ title?: string; note?: string }>().catch(() => ({} as any));
  const cleanTitle = String(title ?? '').trim().slice(0, 200);
  if (!cleanTitle) return c.json({ error: 'Title required' }, 400);
  const cleanNote = note ? String(note).trim().slice(0, 500) : '';
  const id = newId('task');
  db.prepare("INSERT INTO tasks(id,bot_id,title,state,note,created_at,updated_at) VALUES (?,?,?,'working',?,?,?)")
    .run(id, b.id, cleanTitle, cleanNote, now(), now());
  hub.emit(user.id, { type: 'tasks', botId: b.id });
  return c.json({ task: { id, botId: b.id, title: cleanTitle, state: 'working', note: cleanNote, updatedAt: now() } });
});

api.patch('/tasks/:id', async (c) => {
  const user = c.get('user');
  const t = db.prepare('SELECT t.* FROM tasks t JOIN bots b ON b.id=t.bot_id WHERE t.id=? AND b.user_id=?').get(c.req.param('id'), user.id) as any;
  if (!t) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ state?: 'working' | 'needs_input' | 'done'; title?: string; note?: string }>().catch(() => ({} as any));
  const state = body.state && ['working', 'needs_input', 'done'].includes(body.state) ? body.state : t.state;
  const title = body.title !== undefined ? String(body.title).trim().slice(0, 200) || t.title : t.title;
  const note = body.note !== undefined ? (body.note ? String(body.note).trim().slice(0, 500) : '') : (t.note ?? '');
  db.prepare('UPDATE tasks SET title=?, state=?, note=?, updated_at=? WHERE id=?').run(title, state, note, now(), t.id);
  hub.emit(user.id, { type: 'tasks', botId: t.bot_id });
  return c.json({ task: { id: t.id, botId: t.bot_id, title, state, note, updatedAt: now() } });
});

api.delete('/tasks/:id', (c) => {
  const user = c.get('user');
  const t = db.prepare('SELECT t.* FROM tasks t JOIN bots b ON b.id=t.bot_id WHERE t.id=? AND b.user_id=?').get(c.req.param('id'), user.id) as any;
  if (!t) return c.json({ error: 'not found' }, 404);
  db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
  hub.emit(user.id, { type: 'tasks', botId: t.bot_id });
  return c.json({ ok: true });
});

api.get('/tasks', (c) => {
  const rows = db.prepare('SELECT t.* FROM tasks t JOIN bots b ON b.id=t.bot_id WHERE b.user_id=? ORDER BY t.updated_at DESC LIMIT 200').all(c.get('user').id) as any[];
  return c.json({ tasks: rows.map((r) => ({ id: r.id, botId: r.bot_id, title: r.title, state: r.state, note: r.note, updatedAt: r.updated_at })) });
});

api.get('/bots/:id/memories', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rows = db.prepare('SELECT * FROM memories WHERE bot_id=? ORDER BY created_at DESC').all(b.id) as any[];
  return c.json({ memories: rows.map((m) => ({ id: m.id, botId: m.bot_id, text: m.text, createdAt: m.created_at, source: m.source === 'learned' ? 'learned' : 'chat' })) });
});

api.post('/bots/:id/memories', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const { text } = await c.req.json<{ text?: string }>().catch(() => ({} as any));
  const clean = String(text ?? '').trim().slice(0, 500);
  if (!clean) return c.json({ error: 'Memory text is required' }, 400);
  const id = newId('mem');
  const createdAt = now();
  db.prepare("INSERT INTO memories(id,bot_id,text,created_at,source) VALUES (?,?,?,?,'chat')").run(id, b.id, clean, createdAt);
  hub.emit(user.id, { type: 'memories', botId: b.id });
  return c.json({ memory: { id, botId: b.id, text: clean, createdAt, source: 'chat' } });
});

api.delete('/memories/:id', (c) => {
  const user = c.get('user');
  const m = db.prepare('SELECT m.* FROM memories m JOIN bots b ON b.id=m.bot_id WHERE m.id=? AND b.user_id=?').get(c.req.param('id'), user.id) as any;
  if (m) {
    db.prepare('DELETE FROM memories WHERE id=?').run(m.id);
    hub.emit(user.id, { type: 'memories', botId: m.bot_id });
  }
  return c.json({ ok: true });
});

// ---------- global search ----------

api.get('/search', (c) => {
  const user = c.get('user');
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ messages: [], memories: [], tasks: [] });
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const ql = q.toLowerCase();

  const rawRows = db.prepare(
    "SELECT r.seq, r.bot_id, r.body, r.created_at, b.name bot_name FROM rows r JOIN bots b ON b.id=r.bot_id WHERE b.user_id=? AND r.generation=b.generation AND r.kind='message' AND r.body LIKE ? ESCAPE '\\' ORDER BY r.created_at DESC LIMIT 30",
  ).all(user.id, like) as any[];

  const messages: { botId: string; botName: string; seq: number; role: string; snippet: string; createdAt: number }[] = [];
  for (const r of rawRows) {
    const body = JSON.parse(r.body) as RowBody;
    if (body.type !== 'message' || body.streaming) continue;
    const idx = body.text.toLowerCase().indexOf(ql);
    if (idx < 0) continue;
    const start = Math.max(0, idx - 48);
    const end = Math.min(body.text.length, idx + q.length + 72);
    const snippet = `${start > 0 ? '…' : ''}${body.text.slice(start, end).replace(/\s+/g, ' ')}${end < body.text.length ? '…' : ''}`;
    messages.push({ botId: r.bot_id, botName: r.bot_name, seq: r.seq, role: body.role, snippet, createdAt: r.created_at });
    if (messages.length >= 12) break;
  }

  const memRows = db.prepare(
    "SELECT m.id, m.bot_id, m.text, m.created_at, b.name bot_name FROM memories m JOIN bots b ON b.id=m.bot_id WHERE b.user_id=? AND m.text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT 8",
  ).all(user.id, like) as any[];
  const memories = memRows.map((m) => ({ id: m.id, botId: m.bot_id, botName: m.bot_name, text: m.text, createdAt: m.created_at }));

  const taskRows = db.prepare(
    "SELECT t.id, t.bot_id, t.title, t.state, t.updated_at, b.name bot_name FROM tasks t JOIN bots b ON b.id=t.bot_id WHERE b.user_id=? AND (t.title LIKE ? ESCAPE '\\' OR t.note LIKE ? ESCAPE '\\') ORDER BY t.updated_at DESC LIMIT 8",
  ).all(user.id, like, like) as any[];
  const tasks = taskRows.map((t) => ({ id: t.id, botId: t.bot_id, botName: t.bot_name, title: t.title, state: t.state, updatedAt: t.updated_at }));

  return c.json({ messages, memories, tasks });
});

// ---------- computer ----------

api.get('/computer', async (c) => c.json({ computer: await refreshComputer(c.get('user').id) }));

api.post('/computer/ensure', (c) => {
  const userId = c.get('user').id;
  ensureComputer(userId).catch((e) => console.warn('[computer] ensure failed', e.message));
  return c.json({ computer: computerState(userId) });
});

api.post('/computer/suspend', async (c) => {
  await suspendComputer(c.get('user').id);
  return c.json({ computer: computerState(c.get('user').id) });
});

api.get('/bots/:id/screenshot', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const comp = db.prepare("SELECT orgo_id FROM computers WHERE user_id=? AND status='running'").get(user.id) as any;
  const scr = db.prepare('SELECT screen_id FROM screens WHERE bot_id=?').get(b.id) as any;
  if (!comp?.orgo_id || !scr) return c.body(null, 204);
  try {
    const s = await orgo.screenshot(comp.orgo_id, scr.screen_id);
    const b64 = s.image.replace(/^data:[^,]+,/, '');
    return c.body(Buffer.from(b64, 'base64'), 200, { 'Content-Type': s.mime_type ?? 'image/jpeg', 'Cache-Control': 'no-store' });
  } catch {
    return c.body(null, 204);
  }
});

// ---------- apps (Composio marketplace) ----------

api.get('/apps', async (c) => {
  const user = c.get('user');
  const search = (c.req.query('search') ?? '').toLowerCase();
  const category = c.req.query('category') ?? '';
  const [all, connected] = await Promise.all([catalog(), connectedToolkits(user.id).catch(() => new Set<string>())]);
  let items: Toolkit[] = all.map((t) => ({ ...t, connected: connected.has(t.slug) }));
  if (search) items = items.filter((t) => t.name.toLowerCase().includes(search) || t.slug.includes(search) || t.description?.toLowerCase().includes(search));
  if (category) items = items.filter((t) => t.categories.some((x) => x.toLowerCase() === category.toLowerCase()));
  const categories = [...new Set(all.flatMap((t) => t.categories))].sort();
  const connectedApps = all.filter((t) => connected.has(t.slug)).map((t) => ({ ...t, connected: true }));
  return c.json({ apps: items.slice(0, Number(c.req.query('limit') ?? 120)), connected: [...connected], connectedApps, categories, total: items.length });
});

api.post('/apps/:slug/connect', async (c) => {
  const user = c.get('user');
  const slug = c.req.param('slug');
  const { botId, seq } = await c.req.json<{ botId?: string; seq?: number }>().catch(() => ({} as any));
  const cb = new URL(`${env.serverUrl}/api/apps/callback`);
  cb.searchParams.set('slug', slug);
  cb.searchParams.set('uid', user.id);
  if (botId) cb.searchParams.set('bot', botId);
  if (seq) cb.searchParams.set('seq', String(seq));
  const r = await startConnect(user.id, slug, cb.toString());
  return c.json(r);
});

api.get('/apps/callback', async (c) => {
  const userId = userFromCookieHeader(c.req.header('cookie'))?.id || c.req.query('uid') || '';
  const slug = c.req.query('slug') ?? '';
  const botId = c.req.query('bot');
  const seq = Number(c.req.query('seq') ?? 0);
  const ok = c.req.query('status') !== 'failed';
  const userExists = db.prepare('SELECT 1 FROM users WHERE id=?').get(userId);
  if (userExists && ok) {
    let connected = await connectedToolkits(userId).catch(() => new Set<string>());
    if (!connected.has(slug)) {
      await new Promise((r) => setTimeout(r, 1200));
      connected = await connectedToolkits(userId).catch(() => new Set<string>());
    }
    hub.emit(userId, { type: 'connections' });
    if (connected.has(slug) && botId && ownBot(userId, botId)) {
      const info = await toolkitInfo(slug);
      if (seq) {
        const row = getRow(botId, seq);
        if (row?.body.type === 'card' && row.body.card === 'connect') updateRow(botId, seq, { ...row.body, status: 'connected' });
      }
      enqueue(botId, { type: 'system', text: `The user connected ${info?.name ?? slug}. Continue with what you were doing.` });
    }
  }
  return c.html(`<!doctype html><meta charset="utf-8"><title>Connected · TideOS</title><body style="background:#07090e;color:#f3f5fa;font-family:system-ui;padding:48px;text-align:center"><h2 style="margin:0 0 8px">${ok ? '✓ App Connected to TideOS' : 'Connection Failed'}</h2><p style="color:#99a3b8;font-size:14px">${ok ? 'You can close this window.' : 'Please try connecting again from TideOS.'}</p><script>try{window.opener&&window.opener.postMessage({type:'grokbot-connected',slug:${JSON.stringify(slug)},ok:${ok}},'*')}catch(e){};setTimeout(()=>window.close(),700)</script></body>`);
});

api.delete('/apps/:slug', async (c) => {
  await disconnect(c.get('user').id, c.req.param('slug'));
  hub.emit(c.get('user').id, { type: 'connections' });
  return c.json({ ok: true });
});

api.get('/policies', (c) => c.json({ policies: db.prepare('SELECT tool, mode FROM policies WHERE user_id=?').all(c.get('user').id) }));
api.delete('/policies/:tool', (c) => {
  db.prepare('DELETE FROM policies WHERE user_id=? AND tool=?').run(c.get('user').id, c.req.param('tool'));
  return c.json({ ok: true });
});

api.route('/voice', voiceApi);
