import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Project } from '@shared/types';
import { ApiError } from '../../lib/api';
import { configApi } from '../../lib/configApi';
import { MAX_PROJECT_FILES, mergeProjectReferences } from '../../lib/projectReferences';
import { useStore } from '../../store';
import { ConfirmButton } from './ui';

const emptyProject = (): Project => ({ id: '', name: '', instructions: '', files: [], botIds: [], revision: 0 });

export function ProjectsSection() {
  const bots = useStore((s) => s.bots);
  const [projects, setProjects] = useState<Project[]>();
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Project>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  const draftSessionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadProjects = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError('');
    try {
      const { projects: list } = await configApi.projects();
      if (mountedRef.current && loadSeqRef.current === seq) setProjects(list);
    } catch (err) {
      if (mountedRef.current && loadSeqRef.current === seq) setError((err as Error).message);
    } finally {
      if (mountedRef.current && loadSeqRef.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const select = (project?: Project) => {
    draftSessionRef.current += 1;
    setBusy(false);
    setDraft(project);
    setError('');
    setNotice('');
  };

  const importReferences = async (files: File[]) => {
    if (!draft || busy || !files.length) return;
    const session = draftSessionRef.current;
    const baseFiles = draft.files;
    setBusy(true);
    setError('');
    try {
      const references = await mergeProjectReferences(baseFiles, files);
      if (!mountedRef.current || draftSessionRef.current !== session) return;
      setDraft((cur) => (cur ? { ...cur, files: references } : cur));
    } catch (err) {
      if (mountedRef.current && draftSessionRef.current === session) setError((err as Error).message);
    } finally {
      if (mountedRef.current && draftSessionRef.current === session) setBusy(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || busy || !draft.name.trim()) return;
    const session = draftSessionRef.current;
    setBusy(true);
    setError('');
    try {
      const { project } = await configApi.saveProject(draft);
      if (!mountedRef.current) return;
      setProjects((items) => [project, ...(items ?? []).filter(({ id }) => id !== project.id)]);
      if (draftSessionRef.current === session) {
        select(undefined);
        setNotice(`Saved ${project.name}`);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (draftSessionRef.current === session) setError((err as Error).message);
      if (err instanceof ApiError && err.status === 409) {
        void configApi.projects().then(({ projects: refreshed }) => {
          if (mountedRef.current) setProjects(refreshed);
        }).catch(() => {});
      }
    } finally {
      if (mountedRef.current && draftSessionRef.current === session) setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (busy) return;
    const session = draftSessionRef.current;
    setBusy(true);
    try {
      await configApi.deleteProject(id);
      if (!mountedRef.current) return;
      setProjects((items) => items?.filter((project) => project.id !== id));
      if (draftSessionRef.current === session) {
        select(undefined);
        setNotice('Project deleted.');
      }
    } catch (err) {
      if (mountedRef.current && draftSessionRef.current === session) setError((err as Error).message);
    } finally {
      if (mountedRef.current && draftSessionRef.current === session) setBusy(false);
    }
  };

  const assignedElsewhere = new Set(projects?.filter((project) => project.id !== draft?.id).flatMap((project) => project.botIds));

  return <>
    <div className="app-settings__head">
      <h1>Projects</h1>
      <p>Give related bots the same instructions and reference files. Assigned bots send these references to their model in chat.</p>
    </div>
    {error && <p className="cfg-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {draft ? <form className="cfg-editor project-form" onSubmit={save}>
      <fieldset disabled={busy}>
        <label htmlFor="project-name">Project name</label>
        <input id="project-name" className="text-input" value={draft.name} required maxLength={80}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <label htmlFor="project-instructions">Instructions</label>
        <textarea id="project-instructions" className="text-input cfg-textarea" rows={4} value={draft.instructions} maxLength={4000}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
        <label htmlFor="project-files">Reference files</label>
        <input id="project-files" type="file" multiple accept=".md,.txt,.csv,.json" disabled={draft.files.length >= MAX_PROJECT_FILES}
          onChange={(e) => {
            const selected = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = '';
            void importReferences(selected);
          }} />
        {draft.files.map((file) => <div className="project-form__file" key={file.name}>
          <details>
            <summary>{file.name}</summary>
            <pre>{file.text}</pre>
          </details>
          <button className="link-btn" type="button" aria-label={`Remove ${file.name}`}
            onClick={() => setDraft({ ...draft, files: draft.files.filter((other) => other !== file) })}>Remove</button>
        </div>)}
        <span>Assigned bots</span>
        {bots.filter((bot) => bot.kind !== 'room').map((bot) => <label className="project-form__bot" key={bot.id}>
          <input type="checkbox" disabled={assignedElsewhere.has(bot.id)} checked={draft.botIds.includes(bot.id)} onChange={(e) => setDraft({
            ...draft, botIds: e.target.checked ? [...draft.botIds, bot.id] : draft.botIds.filter((id) => id !== bot.id),
          })} />
          {bot.name}{assignedElsewhere.has(bot.id) ? ' · Assigned to another project' : ''}
        </label>)}
        <div className="cfg-editor__actions">
          {draft.id && <ConfirmButton ariaLabel="Delete project" confirmLabel="Delete project" onConfirm={() => remove(draft.id)}>Delete project</ConfirmButton>}
          <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => select(undefined)}>Cancel</button>
          <button type="submit" className="cfg-btn cfg-btn--primary" disabled={!draft.name.trim()}>{busy ? 'Saving…' : 'Save project'}</button>
        </div>
      </fieldset>
    </form> : <section className="cfg-section">
      <button type="button" className="cfg-btn cfg-btn--primary" onClick={() => select(emptyProject())} disabled={!projects}>New project</button>
      {loading && !projects && <p className="cfg-empty">Loading projects…</p>}
      {!loading && !projects && (
        <div className="cfg-empty">
          <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => void loadProjects()}>Retry</button>
        </div>
      )}
      {projects?.map((project) => <div className="cfg-row" key={project.id}>
        <div className="cfg-row__text">
          <div className="cfg-row__title">{project.name}</div>
          <div className="cfg-row__sub">{project.botIds.length} assigned · {project.files.length} {project.files.length === 1 ? 'reference file' : 'reference files'}</div>
        </div>
        <button type="button" className="cfg-btn cfg-btn--secondary" aria-label={`Edit ${project.name}`} onClick={() => select(project)}>Edit</button>
      </div>)}
      {projects?.length === 0 && <p className="cfg-empty">Create a project to share context across bots.</p>}
    </section>}
  </>;
}
