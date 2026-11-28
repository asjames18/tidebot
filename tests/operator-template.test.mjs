// Regression tests for issue #56: Operator templates v2 (duplicate, export, import).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-operator-tpl-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
const envSecret = 'sk-or-v1-envsecretfixture1234567890abcdef';
fs.writeFileSync(
  process.env.ENV_PATH,
  `DEV_LOGIN=1\nOPENROUTER_API_KEY=${envSecret}\nCOMPOSIO_API_KEY=ak_env_composio_secret_1234567890\n`,
  'utf8',
);

const { db } = await import('../server/dist/db.js');
await import('../server/dist/db-config.js');
const { Hono } = await import('hono');
const { api } = await import('../server/dist/routes.js');
const { initSubagents } = await import('../server/dist/agent/subagents.js');
const { initRooms } = await import('../server/dist/agent/rooms.js');
const { saveLlmConfig } = await import('../server/dist/agent/llm.js');
const {
  OPERATOR_TEMPLATE_SCHEMA,
  buildOperatorTemplate,
  validateOperatorTemplate,
} = await import('../server/dist/lib/operatorTemplate.js');

initSubagents();
initRooms();
const app = new Hono();
app.route('/api', api);

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

async function login(email, name) {
  const res = await app.request('/api/auth/dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('validateOperatorTemplate accepts valid templates and refuses malformed or secret-bearing payloads', () => {
  const valid = validateOperatorTemplate({
    schema: OPERATOR_TEMPLATE_SCHEMA,
    name: 'Atlas',
    label: 'Research Analyst',
    description: 'Compares options with citations.',
    instructions: 'Lead with key findings.',
    model: 'anthropic/claude-3.7-sonnet',
    mode: 'teammate',
    effort: 'high',
    avatarShape: 'gem',
    avatarColor: 'blue',
    tools: [{ name: 'Web Brief', description: 'Short summary', body: 'Cite 3 sources.' }],
    memorySeed: ['Prefers concise markdown tables.'],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.template.name, 'Atlas');
  assert.equal(valid.template.tools.length, 1);
  assert.deepEqual(valid.template.memorySeed, ['Prefers concise markdown tables.']);

  const badCases = [
    [null, /JSON object/],
    [['not', 'an', 'object'], /JSON object/],
    [{ name: 'Missing schema' }, /schema/i],
    [{ schema: 'wrong.v1', name: 'Bad schema' }, /schema/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: '   ' }, /name/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', mode: 'admin' }, /mode/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', effort: 'ultra' }, /effort/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', avatarShape: 'triangle' }, /avatarShape/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', avatarColor: 'neon' }, /avatarColor/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', apiKey: 'sk-123' }, /secret|credential/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', openrouterKey: 'sk-123' }, /secret|credential/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', extraField: true }, /Unknown field/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', tools: 'not-array' }, /tools/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', tools: [{ name: 'NoBody' }] }, /body/i],
    [{ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bot', memorySeed: [123] }, /Memory seed/i],
  ];
  for (const [payload, pattern] of badCases) {
    const res = validateOperatorTemplate(payload);
    assert.equal(res.ok, false, `expected failure for ${JSON.stringify(payload)}`);
    assert.match(res.error, pattern);
  }
});

test('buildOperatorTemplate scrubs known secrets and common API token patterns', () => {
  const dbSecret = 'sk-or-v1-dbsecretfixture0987654321fedcba';
  const ghToken = 'ghp_1234567890abcdefghijklmnop';
  const tpl = buildOperatorTemplate(
    {
      name: 'SecBot',
      label: 'Helper',
      description: `Uses ${envSecret}`,
      instructions: `Never leak ${dbSecret} or ${ghToken}`,
      model: 'openai/gpt-4o',
      mode: 'personal',
      effort: 'high',
      avatar_shape: 'shield',
      avatar_color: 'cyan',
    },
    [{ name: 'Audit', description: '', body: `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` }],
    [{ text: `Remember key ${dbSecret}` }],
    [dbSecret],
  );
  const serialized = JSON.stringify(tpl);
  assert.ok(!serialized.includes(envSecret));
  assert.ok(!serialized.includes(dbSecret));
  assert.ok(!serialized.includes(ghToken));
  assert.ok(!serialized.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  assert.ok(serialized.includes('[redacted]'));
});

test('export -> import round-trips job, model, tools, and memory seed without leaking secrets', async () => {
  const cookie = await login('owner-tpl@example.test', 'Owner');
  const dbLlmKey = 'sk-or-v1-storedindbfixture1122334455667788';
  saveLlmConfig({ openrouterKey: dbLlmKey });

  // Create source Operator with job, model, effort, tools (skills), and memory seed
  const createRes = await app.request('/api/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Navigator',
      label: 'Release Coordinator',
      description: 'Tracks release checklists and changelog drafts.',
      instructions: `Check CI before tagging. Ignore accidental token ${dbLlmKey}`,
      model: 'anthropic/claude-3.7-sonnet',
      mode: 'teammate',
      effort: 'high',
      avatarShape: 'gem',
      avatarColor: 'violet',
    }),
  });
  assert.equal(createRes.status, 200);
  const { bot: source } = await createRes.json();

  db.prepare('INSERT INTO skills(id,bot_id,name,description,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run('skl_tpl_1', source.id, 'Changelog Draft', 'Summarize merged PRs', 'Group changes by feat, fix, and docs.', 1000, 1000);
  db.prepare('INSERT INTO skills(id,bot_id,name,description,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run('skl_tpl_2', source.id, 'CI Check', 'Verify release workflow', 'Confirm all matrix jobs are green.', 2000, 2000);
  db.prepare("INSERT INTO memories(id,bot_id,text,created_at,source) VALUES (?,?,?,?,'chat')")
    .run('mem_tpl_1', source.id, 'Releases cut on Fridays at 14:00 UTC.', 1000);
  db.prepare("INSERT INTO memories(id,bot_id,text,created_at,source) VALUES (?,?,?,?,'chat')")
    .run('mem_tpl_2', source.id, 'Always verify desktop installers on Linux, macOS, and Windows.', 2000);

  // Export as template file
  const exportRes = await app.request(`/api/bots/${source.id}/template`, { headers: { cookie } });
  assert.equal(exportRes.status, 200);
  assert.match(exportRes.headers.get('content-type') ?? '', /application\/json/);
  assert.match(exportRes.headers.get('content-disposition') ?? '', /navigator\.tidebot\.json/);
  const exportedText = await exportRes.text();
  assert.ok(!exportedText.includes(envSecret));
  assert.ok(!exportedText.includes(dbLlmKey));
  assert.ok(!exportedText.includes('ak_env_composio_secret_1234567890'));

  const exported = JSON.parse(exportedText);
  assert.equal(exported.schema, OPERATOR_TEMPLATE_SCHEMA);
  assert.equal(exported.name, 'Navigator');
  assert.equal(exported.model, 'anthropic/claude-3.7-sonnet');
  assert.equal(exported.effort, 'high');
  assert.equal(exported.tools.length, 2);
  assert.equal(exported.memorySeed.length, 2);

  // Import into a second user's studio to prove portability
  const otherCookie = await login('recipient-tpl@example.test', 'Recipient');
  // Cross-user export must be refused
  assert.equal((await app.request(`/api/bots/${source.id}/template`, { headers: { cookie: otherCookie } })).status, 404);

  const importRes = await app.request('/api/bots/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: otherCookie },
    body: exportedText,
  });
  assert.equal(importRes.status, 201);
  const { bot: imported, imported: counts } = await importRes.json();
  assert.deepEqual(counts, { tools: 2, memories: 2 });
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.name, 'Navigator');
  assert.equal(imported.label, 'Release Coordinator');
  assert.equal(imported.description, 'Tracks release checklists and changelog drafts.');
  assert.equal(imported.model, 'anthropic/claude-3.7-sonnet');
  assert.equal(imported.mode, 'teammate');
  assert.equal(imported.effort, 'high');
  assert.equal(imported.avatarShape, 'gem');
  assert.equal(imported.avatarColor, 'violet');

  const importedSkills = db.prepare('SELECT name, description, body FROM skills WHERE bot_id=? ORDER BY created_at ASC').all(imported.id);
  assert.deepEqual(importedSkills, [
    { name: 'Changelog Draft', description: 'Summarize merged PRs', body: 'Group changes by feat, fix, and docs.' },
    { name: 'CI Check', description: 'Verify release workflow', body: 'Confirm all matrix jobs are green.' },
  ]);
  const importedMemories = db.prepare('SELECT text FROM memories WHERE bot_id=? ORDER BY created_at ASC').all(imported.id).map((m) => m.text);
  assert.deepEqual(importedMemories, [
    'Releases cut on Fridays at 14:00 UTC.',
    'Always verify desktop installers on Linux, macOS, and Windows.',
  ]);

  // Duplicate via POST /api/bots/:id/clone also preserves effort, tools, and memory seed
  const cloneRes = await app.request(`/api/bots/${source.id}/clone`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(cloneRes.status, 200);
  const { bot: cloned } = await cloneRes.json();
  assert.equal(cloned.name, 'Navigator Copy');
  assert.equal(cloned.effort, 'high');
  assert.equal(cloned.model, 'anthropic/claude-3.7-sonnet');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skills WHERE bot_id=?').get(cloned.id).n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM memories WHERE bot_id=?').get(cloned.id).n, 2);
});

test('POST /api/bots/import refuses malformed files cleanly without creating partial records', async () => {
  const cookie = await login('malformed-tpl@example.test', 'Malformed');
  const beforeCount = (await (await app.request('/api/bots', { headers: { cookie } })).json()).bots.length;

  const badRequests = [
    '{not valid json',
    JSON.stringify({ name: 'Missing schema' }),
    JSON.stringify({ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Has secret', openrouterKey: 'sk-123' }),
    JSON.stringify({ schema: OPERATOR_TEMPLATE_SCHEMA, name: 'Bad tools', tools: [{ name: '' }] }),
  ];

  for (const body of badRequests) {
    const res = await app.request('/api/bots/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body,
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(typeof data.error, 'string');
    assert.ok(data.error.length > 0);
  }

  const afterCount = (await (await app.request('/api/bots', { headers: { cookie } })).json()).bots.length;
  assert.equal(afterCount, beforeCount);
});
