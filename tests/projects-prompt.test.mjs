// Regression tests for project validation/filtering/JSON resilience
// (server/src/projects.ts) and systemPrompt team filtering (server/src/agent/prompt.ts).
// Runs against an isolated temp DB/env; never touches live data or the network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-projects-prompt-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');

const { db } = await import('../server/dist/db.js');
const { listProjects, projectDraft, projectForBot, saveProject } = await import('../server/dist/projects.js');
const { systemPrompt } = await import('../server/dist/agent/prompt.js');

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,1)').run('u-1', 'owner@example.test', 'Owner');
db.prepare("INSERT INTO bots(id,user_id,name,label,kind,hidden,created_at,updated_at) VALUES (?,?,?,?,'agent',0,1,1)").run('b-primary', 'u-1', 'Quinn', 'Lead');
db.prepare("INSERT INTO bots(id,user_id,name,label,kind,hidden,created_at,updated_at) VALUES (?,?,?,?,'agent',0,2,2)").run('b-helper', 'u-1', 'Mina', 'Research');
db.prepare("INSERT INTO bots(id,user_id,name,label,kind,hidden,created_at,updated_at) VALUES (?,?,?,?,'room',0,3,3)").run('b-room', 'u-1', 'Standup Room', '');
db.prepare("INSERT INTO bots(id,user_id,name,label,kind,hidden,created_at,updated_at) VALUES (?,?,?,?,'agent',1,4,4)").run('b-subagent', 'u-1', 'Hidden Worker', '');

test('projectDraft rejects dot-prefixed names, control chars, duplicate names, and blank text', () => {
  assert.equal(projectDraft.safeParse({
    name: 'Valid Project',
    instructions: 'Follow style guide.',
    files: [{ name: 'notes.md', text: '  # Title\nBody' }],
    botIds: ['b-primary'],
  }).success, true);

  for (const badName of ['.env.json', '..md', '...txt', 'bad\x7fname.md', 'dir/file.md', 'a\\b.txt']) {
    assert.equal(projectDraft.safeParse({
      name: 'P',
      instructions: '',
      files: [{ name: badName, text: 'content' }],
      botIds: [],
    }).success, false, `expected ${JSON.stringify(badName)} to be rejected`);
  }

  assert.equal(projectDraft.safeParse({
    name: 'P',
    instructions: '',
    files: [{ name: 'notes.md', text: '   \n\t  ' }],
    botIds: [],
  }).success, false, 'whitespace-only reference text should be rejected');

  assert.equal(projectDraft.safeParse({
    name: 'P',
    instructions: '',
    files: [
      { name: 'Notes.md', text: 'a' },
      { name: 'notes.MD', text: 'b' },
    ],
    botIds: [],
  }).success, false, 'case-insensitive duplicate filenames should be rejected');
});

test('saveProject excludes rooms and hidden subagents and degrades cleanly on corrupt files JSON', () => {
  const roomRes = saveProject('u-1', { name: 'Room Project', instructions: '', files: [], botIds: ['b-room'] });
  assert.ok('error' in roomRes && roomRes.status === 409, 'group rooms must not be assignable to projects');

  const subRes = saveProject('u-1', { name: 'Subagent Project', instructions: '', files: [], botIds: ['b-subagent'] });
  assert.ok('error' in subRes && subRes.status === 409, 'hidden subagents must not be assignable to projects');

  const okRes = saveProject('u-1', {
    name: 'Core Project',
    instructions: 'Be thorough.',
    files: [{ name: 'brief.md', text: 'Project brief' }],
    botIds: ['b-primary'],
  });
  assert.ok('project' in okRes);
  const projectId = okRes.project.id;

  // Even if legacy/corrupt DB state links a room or subagent or corrupts files JSON, reads degrade safely.
  db.prepare('UPDATE bots SET project_id=? WHERE id IN (?,?)').run(projectId, 'b-room', 'b-subagent');
  db.prepare('UPDATE projects SET files=? WHERE id=?').run('{corrupt json', projectId);

  const listed = listProjects('u-1');
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].botIds, ['b-primary']);
  assert.deepEqual(listed[0].files, []);

  const forBot = projectForBot('u-1', 'b-primary');
  assert.ok(forBot);
  assert.deepEqual(forBot.files, []);
});

test('systemPrompt excludes group rooms and hidden subagents from team list and guards missing bot', async () => {
  const prompt = await systemPrompt('u-1', 'b-primary');
  assert.ok(prompt.includes('- Mina (Research)'), 'visible teammate agent should be listed');
  assert.ok(!prompt.includes('Standup Room'), 'group room must not appear as a delegatable teammate bot');
  assert.ok(!prompt.includes('Hidden Worker'), 'hidden subagent must not appear as a teammate bot');

  await assert.rejects(() => systemPrompt('u-1', 'non-existent-bot'), /Bot not found/);
});
