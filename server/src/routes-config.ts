import fs from 'node:fs';
import nodePath from 'node:path';
import { Hono } from 'hono';
import { db, now } from './db.js';
import './db-config.js';
import { env } from './env.js';
import { newId } from './lib/ids.js';
import { hub } from './lib/hub.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import { getBotRow, listRoutines, listTasks } from './store.js';
import { computerState, ensureComputer } from './computer.js';
import { orgo } from './orgo.js';
import { catalog } from './composio.js';
import { runInBotQueue } from './agent/loop.js';
import { localWorkspaceDir } from './agent/tools.js';
import { consolidateBot, historySize, maybeCompact, memoryConfig } from './agent/memory.js';
import { completeText, fetchModelsCatalog, getPublicLlmConfig, saveLlmConfig, testLlmConnection } from './agent/llm.js';
import { idleConfig, viewerCount } from './idle.js';
import { assertPublicUrl } from './lib/ssrf.js';
import { resolveWithinWorkspace } from './lib/files.js';
import { loadHistory } from './store.js';
import type { LibraryFile, Memory, Skill } from './types.js';

/**
 * Bot settings, skills, library, computer controls and memory maintenance.
 * Mounted next to routes.ts in index.ts; every path here needs a signed-in user.
 */
export const configApi = new Hono<AuthVars>();

for (const p of ['/bots/*', '/skills/*', '/computer/*', '/llm/*']) configApi.use(p, requireUser);

// ---------- BYOM / OpenRouter runtime config & models ----------

configApi.get('/llm/config', (c) => {
  return c.json(getPublicLlmConfig());
});

const isOwner = (userId: string) => {
  const first = db.prepare('SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1').get() as any;
  return Boolean(first) && first.id === userId;
};

configApi.put('/llm/config', async (c) => {
  if (!isOwner(c.get('user').id)) return c.json({ error: 'Only the workspace owner can change global LLM settings' }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (body.customBaseUrl !== undefined && String(body.customBaseUrl).trim()) {
    try { await assertPublicUrl(String(body.customBaseUrl).trim(), { allowLoopback: true }); }
    catch (e: any) { return c.json({ error: `Invalid customBaseUrl: ${e?.message ?? e}` }, 400); }
  }
  let updated;
  try {
    updated = saveLlmConfig({
    provider: body.provider,
    openrouterKey: body.openrouterKey,
    xaiKey: body.xaiKey,
    customBaseUrl: body.customBaseUrl,
    customApiKey: body.customApiKey,
    defaultModel: body.defaultModel,
    shaderStyle: body.shaderStyle,
      composioKey: body.composioKey,
      orgoKey: body.orgoKey,
    });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 400);
  }
  return c.json(updated);
});

configApi.post('/llm/test', async (c) => {
  return c.json(await testLlmConnection());
});

configApi.post('/llm/test-composio', async (c) => {
  const t0 = Date.now();
  try {
    if (!env.composioKey) return c.json({ ok: false, error: 'COMPOSIO_API_KEY is not configured.' });
    const items = await catalog();
    return c.json({ ok: true, count: items.length, latencyMs: Date.now() - t0 });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message ?? e) });
  }
});

configApi.get('/llm/models', async (c) => {
  return c.json(await fetchModelsCatalog());
});

configApi.post('/llm/enhance', async (c) => {
  const { text, botName, botRole } = await c.req.json().catch(() => ({}));
  const raw = String(text ?? '').trim();
  if (!raw) return c.json({ error: 'Prompt text is required' }, 400);
  try {
    const enhanced = await completeText({
      system:
        `You are a prompt optimizer for TideBot autonomous AI operators${botName ? ` (currently targeting ${botName}${botRole ? `, ${botRole}` : ''})` : ''}. ` +
        `Rewrite the user's draft instruction into a clear, actionable, high-signal prompt that specifies concrete deliverables, relevant tools (e.g., web_search, fetch_webpage, save_file, shell, or connected Composio apps), and formatting expectations. ` +
        `Keep it concise (1-4 sentences). Output ONLY the improved prompt text with no surrounding quotes or preamble.`,
      user: raw,
      maxTokens: 320,
    });
    return c.json({ ok: true, text: enhanced.trim() || raw });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message ?? e) }, 502);
  }
});

const ownBot = (userId: string, id: string) => {
  const b = getBotRow(id);
  return b && b.user_id === userId ? b : null;
};

const toMemory = (m: any): Memory => ({ id: m.id, botId: m.bot_id, text: m.text, createdAt: m.created_at, source: m.source === 'learned' ? 'learned' : 'chat' });
const toSkill = (s: any): Skill => ({ id: s.id, botId: s.bot_id, name: s.name, description: s.description ?? '', body: s.body, createdAt: s.created_at, updatedAt: s.updated_at ?? s.created_at });
const listSkills = (botId: string) => (db.prepare('SELECT * FROM skills WHERE bot_id=? ORDER BY created_at ASC').all(botId) as any[]).map(toSkill);

// ---------- settings bundle ----------

configApi.get('/bots/:id/settings', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const memories = (db.prepare('SELECT * FROM memories WHERE bot_id=? ORDER BY created_at DESC').all(b.id) as any[]).map(toMemory);
  const job = db.prepare('SELECT last_consolidated_at, last_result FROM memory_jobs WHERE bot_id=?').get(b.id) as any;
  const lastCompaction = db.prepare('SELECT method, items_before, items_after, chars_before, chars_after, created_at FROM compactions WHERE bot_id=? ORDER BY id DESC LIMIT 1').get(b.id) as any;
  return c.json({
    memories,
    skills: listSkills(b.id),
    routines: listRoutines(b.id),
    tasks: listTasks(b.id),
    memory: {
      lastConsolidatedAt: job?.last_consolidated_at ?? null,
      historyChars: historySize(b.id, loadHistory(b.id)),
      compactAtChars: memoryConfig.compactChars,
      lastCompaction: lastCompaction ?? null,
    },
  });
});

// ---------- skills ----------

function cleanSkill(p: any, partial = false): { name?: string; description?: string; body?: string } | string {
  const out: { name?: string; description?: string; body?: string } = {};
  if (p.name !== undefined || !partial) {
    const name = String(p.name ?? '').trim();
    if (!name) return 'Give the skill a name';
    out.name = name.slice(0, 80);
  }
  if (p.body !== undefined || !partial) {
    const body = String(p.body ?? '').trim();
    if (!body) return 'Write the steps for this skill';
    out.body = body.slice(0, 20_000);
  }
  if (p.description !== undefined) out.description = String(p.description).trim().slice(0, 300);
  return out;
}

configApi.get('/bots/:id/skills', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json({ skills: listSkills(b.id) }) : c.json({ error: 'not found' }, 404);
});

configApi.post('/bots/:id/skills', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const s = cleanSkill(await c.req.json().catch(() => ({})));
  if (typeof s === 'string') return c.json({ error: s }, 400);
  const id = newId('skl');
  db.prepare('INSERT INTO skills(id,bot_id,name,body,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, b.id, s.name, s.body, s.description ?? '', now(), now());
  return c.json({ skill: toSkill(db.prepare('SELECT * FROM skills WHERE id=?').get(id)) });
});

const ownSkill = (userId: string, id: string) =>
  db.prepare('SELECT s.* FROM skills s JOIN bots b ON b.id=s.bot_id WHERE s.id=? AND b.user_id=?').get(id, userId) as any;

configApi.patch('/skills/:id', async (c) => {
  const cur = ownSkill(c.get('user').id, c.req.param('id'));
  if (!cur) return c.json({ error: 'not found' }, 404);
  const s = cleanSkill(await c.req.json().catch(() => ({})), true);
  if (typeof s === 'string') return c.json({ error: s }, 400);
  db.prepare('UPDATE skills SET name=?, body=?, description=?, updated_at=? WHERE id=?').run(s.name ?? cur.name, s.body ?? cur.body, s.description ?? cur.description ?? '', now(), cur.id);
  return c.json({ skill: toSkill(db.prepare('SELECT * FROM skills WHERE id=?').get(cur.id)) });
});

configApi.delete('/skills/:id', (c) => {
  const cur = ownSkill(c.get('user').id, c.req.param('id'));
  if (!cur) return c.json({ error: 'not found' }, 404);
  db.prepare('DELETE FROM skills WHERE id=?').run(cur.id);
  return c.json({ ok: true });
});

// ---------- memory maintenance ----------

/** Run consolidation now instead of waiting for the idle window. */
configApi.post('/bots/:id/memories/consolidate', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  try {
    return c.json(await consolidateBot(b.id));
  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 502);
  }
});

/** Compact the stored history now (inside the bot's queue). `force` compacts even under the threshold. */
configApi.post('/bots/:id/compact', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const force = c.req.query('force') === '1';
  const before = loadHistory(b.id).length;
  const after = await runInBotQueue(b.id, async () => (await maybeCompact(b.id, loadHistory(b.id), { force })).length);
  return c.json({ itemsBefore: before, itemsAfter: after, compacted: after !== before });
});

// ---------- library: files under /root/grokbot/files/<botId> on the bot's computer ----------

const LIB_ROOT = '/root/grokbot/files';

function safeRel(p: string | undefined): string | null {
  const rel = (p ?? '').replace(/^\/+|\/+$/g, '');
  if (!rel) return '';
  if (rel.split('/').some((s) => !s || s === '.' || s === '..') || /[\0\n\r]/.test(rel)) return null;
  return rel;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Parse `ls -la --time-style=+%s` output. */
export function parseLs(out: string): LibraryFile[] {
  const files: LibraryFile[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^([-dlcbps])\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    let name = m[4];
    if (m[1] === 'l') name = name.replace(/ -> .*$/, '');
    if (name === '.' || name === '..') continue;
    files.push({ name, size: Number(m[2]), modifiedAt: Number(m[3]) * 1000, isDir: m[1] === 'd' });
  }
  return files.sort((a, b) => Number(b.isDir) - Number(a.isDir) || b.modifiedAt - a.modifiedAt);
}

/** The bot's computer id if it is awake (or `wake` is set), plus the bot's leased screen if it has one. */
async function boxFor(userId: string, botId: string, wake: boolean): Promise<{ computerId: string; screenId?: string } | null> {
  const comp = db.prepare('SELECT orgo_id, status FROM computers WHERE user_id=?').get(userId) as any;
  let computerId: string | null = comp?.status === 'running' ? comp.orgo_id : null;
  if (!computerId && wake) computerId = await ensureComputer(userId);
  if (!computerId) return null;
  // Use the bot's own screen when it has one; never lease (and evict) a screen just to list files.
  const scr = db.prepare('SELECT screen_id FROM screens WHERE bot_id=?').get(botId) as any;
  return { computerId, screenId: scr?.screen_id };
}

configApi.get('/bots/:id/files', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rel = safeRel(c.req.query('path'));
  if (rel === null) return c.json({ error: 'bad path' }, 400);

  const localFiles: LibraryFile[] = [];
  try {
    const rootDir = localWorkspaceDir(b.id);
    const targetDir = resolveWithinWorkspace(rootDir, rel || '.');
    if (!targetDir) throw new Error('bad path');
    fs.mkdirSync(targetDir, { recursive: true });
    for (const e of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const st = fs.statSync(nodePath.join(targetDir, e.name));
      localFiles.push({ name: e.name, size: st.size, modifiedAt: st.mtimeMs, isDir: e.isDirectory() });
    }
  } catch { /* ignore */ }

  if (!env.orgoKey) {
    localFiles.sort((x, y) => Number(y.isDir) - Number(x.isDir) || y.modifiedAt - x.modifiedAt);
    return c.json({ status: 'ok', path: rel, files: localFiles });
  }
  try {
    const box = await boxFor(user.id, b.id, c.req.query('wake') === '1');
    if (!box) {
      localFiles.sort((x, y) => Number(y.isDir) - Number(x.isDir) || y.modifiedAt - x.modifiedAt);
      return c.json({ status: localFiles.length ? 'ok' : 'asleep', path: rel, files: localFiles });
    }
    const dir = `${LIB_ROOT}/${b.id}${rel ? `/${rel}` : ''}`;
    const r = await orgo.bash(box.computerId, box.screenId, `mkdir -p ${shq(`${LIB_ROOT}/${b.id}`)} && ls -la --time-style=+%s ${shq(dir)} 2>&1`, 30);
    const remoteFiles = r.exit_code === 0 ? parseLs(r.output ?? '') : [];
    const byName = new Map<string, LibraryFile>();
    for (const f of remoteFiles) byName.set(f.name, f);
    for (const f of localFiles) byName.set(f.name, f);
    const merged = [...byName.values()].sort((x, y) => Number(y.isDir) - Number(x.isDir) || y.modifiedAt - x.modifiedAt);
    return c.json({ status: 'ok', path: rel, files: merged });
  } catch (e: any) {
    if (localFiles.length) return c.json({ status: 'ok', path: rel, files: localFiles });
    return c.json({ status: 'error', path: rel, files: [], error: String(e?.message ?? e).slice(0, 300) });
  }
});

configApi.get('/bots/:id/files/raw', (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rel = safeRel(c.req.query('path'));
  if (!rel) return c.json({ error: 'bad path' }, 400);
  const fullPath = resolveWithinWorkspace(localWorkspaceDir(b.id), rel);
  if (!fullPath || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    return c.json({ error: 'file not found' }, 404);
  }
  const buf = fs.readFileSync(fullPath);
  const baseName = nodePath.basename(fullPath);
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${baseName.replace(/"/g, '')}"`,
    },
  });
});

configApi.get('/bots/:id/files/content', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rel = safeRel(c.req.query('path'));
  if (!rel) return c.json({ error: 'bad path' }, 400);
  const localPath = resolveWithinWorkspace(localWorkspaceDir(b.id), rel);
  if (localPath && fs.existsSync(localPath) && !fs.statSync(localPath).isDirectory()) {
    const content = fs.readFileSync(localPath, 'utf8').slice(0, 150_000);
    return c.json({ ok: true, path: rel, content });
  }
  if (env.orgoKey) {
    try {
      const box = await boxFor(user.id, b.id, false);
      if (box) {
        const r = await orgo.bash(box.computerId, box.screenId, `head -c 150000 ${shq(`${LIB_ROOT}/${b.id}/${rel}`)}`, 20);
        if (r.exit_code === 0) return c.json({ ok: true, path: rel, content: r.output ?? '' });
      }
    } catch { /* fall through */ }
  }
  return c.json({ error: 'File not found' }, 404);
});

configApi.post('/bots/:id/files', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ path?: string; content?: string }>().catch(() => ({} as any));
  const rel = safeRel(body.path);
  if (!rel) return c.json({ error: 'Valid file path is required' }, 400);
  const content = String(body.content ?? '');
  if (content.length > 10_000_000) return c.json({ error: 'File too large (max 10 MB)' }, 413);
  const localPath = resolveWithinWorkspace(localWorkspaceDir(b.id), rel);
  if (!localPath) return c.json({ error: 'bad path' }, 400);
  fs.mkdirSync(nodePath.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, content, 'utf8');
  return c.json({ ok: true, path: rel, size: Buffer.byteLength(content, 'utf8') });
});

configApi.delete('/bots/:id/files', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rel = safeRel(c.req.query('path'));
  if (!rel) return c.json({ error: 'bad path' }, 400);
  const joined = nodePath.join(localWorkspaceDir(b.id), rel);
  const localPath = fs.existsSync(joined) && fs.lstatSync(joined).isSymbolicLink() ? joined : resolveWithinWorkspace(localWorkspaceDir(b.id), rel);
  if (localPath && fs.existsSync(localPath)) {
    fs.rmSync(localPath, { recursive: true, force: true });
  }
  if (env.orgoKey) {
    const box = await boxFor(user.id, b.id, false).catch(() => null);
    if (box) await orgo.bash(box.computerId, box.screenId, `rm -rf ${shq(`${LIB_ROOT}/${b.id}/${rel}`)}`, 15).catch(() => null);
  }
  return c.json({ ok: true });
});

configApi.post('/bots/:id/files/download', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const { path } = await c.req.json<{ path: string }>().catch(() => ({ path: '' }));
  const rel = safeRel(path);
  if (!rel) return c.json({ error: 'bad path' }, 400);
  const localPath = resolveWithinWorkspace(localWorkspaceDir(b.id), rel);
  if (localPath && fs.existsSync(localPath) && !fs.statSync(localPath).isDirectory()) {
    return c.json({ url: `/api/bots/${b.id}/files/raw?path=${encodeURIComponent(rel)}` });
  }
  if (!env.orgoKey) {
    return c.json({ url: `/api/bots/${b.id}/files/raw?path=${encodeURIComponent(rel)}` });
  }
  try {
    const box = await boxFor(user.id, b.id, true);
    if (!box) return c.json({ error: 'computer unavailable' }, 409);
    const r: any = await orgo.exportFile(box.computerId, `${LIB_ROOT}/${b.id}/${rel}`);
    const url = r?.url ?? r?.file?.url ?? r?.download_url;
    if (!url) return c.json({ error: 'export returned no link' }, 502);
    return c.json({ url });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e).slice(0, 300) }, 502);
  }
});

// ---------- computer: screens, reset, hibernation ----------

configApi.get('/computer/details', (c) => {
  const userId = c.get('user').id;
  const leases = db.prepare('SELECT bot_id, screen_id, last_used_at FROM screens WHERE user_id=? ORDER BY last_used_at DESC').all(userId) as any[];
  return c.json({
    computer: computerState(userId),
    screens: leases.map((l) => ({ botId: l.bot_id, screenId: l.screen_id, lastUsedAt: l.last_used_at })),
    hibernation: { idleMinutes: idleConfig.idleMin, viewers: viewerCount(userId), dryRun: idleConfig.dryRun },
  });
});

/** Give a bot a clean screen: close its windows (default screen) or destroy its extra screen so a fresh one is made next time. */
configApi.post('/bots/:id/screen/reset', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const lease = db.prepare('SELECT screen_id FROM screens WHERE bot_id=?').get(b.id) as any;
  if (!lease) return c.json({ ok: true, note: 'no screen yet' });
  const comp = db.prepare("SELECT orgo_id FROM computers WHERE user_id=? AND status='running'").get(user.id) as any;
  if (!comp?.orgo_id) return c.json({ error: 'Wake the computer first' }, 409);
  const profile = `/root/grokbot/profiles/${b.id}`;
  try {
    await orgo.bash(comp.orgo_id, undefined, `pkill -f ${shq(`user-data-dir=${profile}`)}; rm -f ${shq(profile)}/Singleton*; echo ok`, 30).catch(() => null);
    if (lease.screen_id !== 'default') {
      await orgo.deleteScreen(comp.orgo_id, lease.screen_id).catch((e) => console.warn('[computer] delete screen', e?.message));
      db.prepare('DELETE FROM screens WHERE bot_id=?').run(b.id);
    }
    console.log(`[computer] reset screen ${lease.screen_id} for bot ${b.id}`);
    hub.emit(user.id, { type: 'computer', state: computerState(user.id) });
    return c.json({ ok: true, screenId: lease.screen_id });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e).slice(0, 300) }, 502);
  }
});
