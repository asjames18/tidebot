import { z } from 'zod';
import { db, now } from './db.js';
import { newId } from './lib/ids.js';
import type { Project } from './types.js';

export const projectDraft = z.object({
  name: z.string().trim().min(1).max(80),
  instructions: z.string().trim().max(4000),
  files: z.array(z.object({
    name: z.string().trim().max(160).regex(/^[^/\\\x00-\x1f]+\.(?:md|txt|csv|json)$/i),
    text: z.string().min(1).max(8000),
  })).max(6),
  botIds: z.array(z.string().min(1).max(80)).max(100),
}).refine(({ files }) => new Set(files.map((file) => file.name.toLowerCase())).size === files.length, {
  message: 'Reference file names must be unique.',
});

type Draft = z.infer<typeof projectDraft>;
type ProjectRow = { id: string; name: string; instructions: string; files: string; revision: number };
type SaveResult = { project: Project } | { error: string; status: 400 | 404 | 409 };

function toProject(row: ProjectRow, botIds: string[]): Project {
  return { id: row.id, name: row.name, instructions: row.instructions, files: JSON.parse(row.files), revision: row.revision, botIds };
}

export function listProjects(userId: string) {
  const bots = db.prepare('SELECT id, project_id FROM bots WHERE user_id=? AND project_id IS NOT NULL ORDER BY created_at')
    .all(userId) as { id: string; project_id: string }[];
  const projects = db.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC').all(userId) as ProjectRow[];
  return projects.map((project) => toProject(project, bots.filter((bot) => bot.project_id === project.id).map((bot) => bot.id)));
}

export function saveProject(userId: string, draft: Draft, existing?: { id: string; revision: number }): SaveResult {
  return db.transaction((): SaveResult => {
    const projectId = existing?.id ?? newId('prj');
    const current = db.prepare('SELECT revision FROM projects WHERE id=? AND user_id=?').get(projectId, userId) as { revision: number } | undefined;
    if (existing && !current) return { error: 'Project not found.', status: 404 };
    if (existing && current?.revision !== existing.revision) return { error: 'This project changed. Reopen it to see the latest version.', status: 409 };
    if (!existing && db.prepare('SELECT 1 FROM projects WHERE user_id=? LIMIT 1 OFFSET 19').get(userId)) {
      return { error: 'You can create up to 20 projects.', status: 400 };
    }
    const botIds = [...new Set(draft.botIds)];
    const available = db.prepare("SELECT id FROM bots WHERE user_id=? AND kind<>'room' AND (project_id IS NULL OR project_id=?)")
      .all(userId, projectId) as { id: string }[];
    const allowed = new Set(available.map(({ id }) => id));
    if (botIds.some((id) => !allowed.has(id))) return { error: 'A selected bot is unavailable or belongs to another project.', status: 409 };

    const revision = (current?.revision ?? 0) + 1;
    db.prepare(`INSERT INTO projects(id, user_id, name, instructions, files, revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, instructions=excluded.instructions, files=excluded.files, revision=excluded.revision, updated_at=excluded.updated_at`)
      .run(projectId, userId, draft.name, draft.instructions, JSON.stringify(draft.files), revision, now());
    db.prepare('UPDATE bots SET project_id=NULL WHERE user_id=? AND project_id=?').run(userId, projectId);
    const assign = db.prepare('UPDATE bots SET project_id=? WHERE id=? AND user_id=?');
    for (const id of botIds) assign.run(projectId, id, userId);
    return { project: { id: projectId, ...draft, botIds, revision } };
  })();
}

export function deleteProject(userId: string, id: string) {
  return db.prepare('DELETE FROM projects WHERE user_id=? AND id=?').run(userId, id).changes > 0;
}

export function projectForBot(userId: string, botId: string) {
  const row = db.prepare(`SELECT p.* FROM projects p JOIN bots b ON b.project_id=p.id AND b.user_id=p.user_id
    WHERE p.user_id=? AND b.id=?`).get(userId, botId) as ProjectRow | undefined;
  return row && toProject(row, []);
}
