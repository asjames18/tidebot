import { useCallback, useEffect, useState } from 'react';
import type { Bot, LibraryFile } from '@shared/types';
import { configApi, type LibraryListing } from '../../lib/configApi';
import { relativeShort } from '../../lib/time';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { Markdown } from '../Markdown';
import { Glyph } from './glyphs';
import { formatBytes } from './ui';

/** Files the bot saved under its workspace or /root/grokbot/files/<botId>. */
export function LibraryTab({ bot }: { bot: Bot }) {
  const awake = useStore((s) => s.computer?.status === 'running');
  const [path, setPath] = useState('');
  const [list, setList] = useState<LibraryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Preview / Editor state
  const [preview, setPreview] = useState<{ name: string; rel: string; content: string; editing: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFilename, setNewFilename] = useState('notes.md');
  const [newContent, setNewContent] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (wake = false) => {
    setLoading(true); setError(null);
    try { setList(await configApi.files(bot.id, path, wake)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [bot.id, path]);

  useEffect(() => { setPath(''); setList(null); setPreview(null); setCreating(false); }, [bot.id]);
  useEffect(() => { load(); }, [load, awake]);

  const download = async (f: LibraryFile) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    const rel = path ? `${path}/${f.name}` : f.name;
    setBusyFile(f.name); setError(null);
    try {
      const { url } = await configApi.downloadFile(bot.id, rel);
      const a = document.createElement('a');
      a.href = url; a.download = f.name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { setError(`Couldn’t download ${f.name}: ${(e as Error).message}`); }
    finally { setBusyFile(null); }
  };

  const openFile = async (f: LibraryFile) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    const rel = path ? `${path}/${f.name}` : f.name;
    setBusyFile(f.name); setError(null);
    try {
      const res = await configApi.fileContent(bot.id, rel);
      setPreview({ name: f.name, rel, content: res.content, editing: false });
    } catch {
      await download(f);
    } finally {
      setBusyFile(null);
    }
  };

  const savePreviewEdit = async () => {
    if (!preview) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
    setBusyFile(preview.name);
    try {
      await configApi.saveFile(bot.id, preview.rel, preview.content);
      setPreview({ ...preview, editing: false });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyFile(null);
    }
  };

  const createNewFile = async () => {
    const clean = newFilename.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!clean) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
    const rel = path ? `${path}/${clean}` : clean;
    setLoading(true);
    try {
      await configApi.saveFile(bot.id, rel, newContent);
      setCreating(false);
      setNewFilename('notes.md');
      setNewContent('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const removeFile = async (rel: string) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
    try {
      await configApi.deleteFile(bot.id, rel);
      if (preview?.rel === rel) setPreview(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const crumbs = path ? path.split('/') : [];

  return (
    <div className="details__sections">
      <section>
        <div className="section-label section-label--row">
          <span className="lib-crumbs">
            {crumbs.length ? (
              <>
                <button type="button" className="link-btn link-btn--small" onClick={() => setPath('')}>Files</button>
                {crumbs.map((c, i) => (
                  <span key={i} className="lib-crumbs__part">
                    <Icon name="chev_right" size={8} opacity={0.5} />
                    <button type="button" className="link-btn link-btn--small" onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
                  </span>
                ))}
              </>
            ) : 'Workspace Library'}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="link-btn link-btn--small"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                setCreating((v) => !v);
                setPreview(null);
              }}
            >
              {creating ? 'Cancel' : '+ New'}
            </button>
            <button
              type="button"
              className="link-btn link-btn--small"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                load();
              }}
              disabled={loading}
              aria-label="Refresh files"
              title="Refresh"
            >
              <Icon name="refresh" size={12} opacity={0.7} style={loading ? { animation: 'cfg-spin 0.8s linear infinite' } : undefined} />
            </button>
          </span>
        </div>

        {creating && (
          <div className="panel-card" style={{ padding: 10, gap: 8 }}>
            <input
              type="text"
              className="cfg-input"
              placeholder="filename.md"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
            />
            <textarea
              className="cfg-textarea"
              rows={5}
              placeholder="Write file contents…"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                  setCreating(false);
                }}
              >
                Cancel
              </button>
              <button type="button" className="cfg-btn cfg-btn--primary" onClick={() => void createNewFile()}>Save File</button>
            </div>
          </div>
        )}

        {preview && (
          <div className="panel-card" style={{ padding: 10, gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <strong style={{ fontSize: 12.5, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {preview.name}
              </strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="link-btn link-btn--small"
                  onClick={() => {
                    navigator.clipboard?.writeText(preview.content);
                    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  className="link-btn link-btn--small"
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                    setPreview({ ...preview, editing: !preview.editing });
                  }}
                >
                  {preview.editing ? 'Preview' : 'Edit'}
                </button>
                <button
                  type="button"
                  className="link-btn link-btn--small"
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                    setPreview(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            {preview.editing ? (
              <>
                <textarea
                  className="cfg-textarea"
                  rows={8}
                  value={preview.content}
                  onChange={(e) => setPreview({ ...preview, content: e.target.value })}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <button type="button" className="cfg-btn cfg-btn--danger" onClick={() => void removeFile(preview.rel)}>Delete</button>
                  <button type="button" className="cfg-btn cfg-btn--primary" onClick={() => void savePreviewEdit()}>Save Changes</button>
                </div>
              </>
            ) : preview.name.endsWith('.md') ? (
              <div
                className="lib-preview__content"
                style={{ fontSize: 12.5, maxHeight: 260, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '6px 4px', borderTop: '1px solid var(--color-border-tertiary)' }}
              >
                <Markdown text={preview.content} />
              </div>
            ) : (
              <pre
                className="lib-preview__content"
                style={{ margin: 0, fontSize: 11.5, maxHeight: 260, overflow: 'auto', WebkitOverflowScrolling: 'touch', padding: 8, borderRadius: 8, background: 'var(--color-bg-tertiary)', color: 'var(--color-ink)', whiteSpace: 'pre-wrap' }}
              >
                {preview.content}
              </pre>
            )}
          </div>
        )}

        <div className="panel-card">
          {list?.status === 'asleep' ? (
            <div className="lib-empty">
              <div>{bot.name}’s cloud computer is asleep. Local workspace files appear here automatically, or wake the computer to inspect VM files.</div>
              <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => load(true)} disabled={loading}>{loading ? 'Waking…' : 'Wake cloud computer'}</button>
            </div>
          ) : !list && loading ? (
            <div className="panel-empty">Looking for files…</div>
          ) : list?.status === 'error' ? (
            <div className="panel-empty">Couldn’t load files. {list.error ? <span className="lib-err">{list.error}</span> : null}</div>
          ) : !list?.files.length ? (
            <div className="panel-empty panel-empty--center">{path ? 'This folder is empty.' : `Deliverables that ${bot.name} creates (reports, code, markdown) are kept here.`}</div>
          ) : (
            list.files.map((f) => {
              const rel = path ? `${path}/${f.name}` : f.name;
              return (
                <div key={f.name} className={`lib-row${f.isDir ? ' is-dir' : ''}`}>
                  <button type="button" className="lib-row__main" onClick={() => (f.isDir ? setPath(rel) : openFile(f))} title={f.isDir ? `Open ${f.name}` : `Preview ${f.name}`}>
                    <span className="lib-row__icon"><Glyph name={f.isDir ? 'folder' : 'doc'} size={16} opacity={0.6} /></span>
                    <span className="panel-row__text">
                      <span className="panel-row__title">{f.name}</span>
                      <span className="panel-row__meta">{f.isDir ? 'Folder' : formatBytes(f.size)} · {relativeShort(f.modifiedAt) === 'now' ? 'just now' : relativeShort(f.modifiedAt)}</span>
                    </span>
                  </button>
                  {f.isDir ? <Icon name="chev_right" size={12} opacity={0.5} /> : (
                    <button type="button" className="cfg-icon-btn" onClick={() => download(f)} disabled={busyFile === f.name} aria-label={`Download ${f.name}`} title="Download">
                      {busyFile === f.name ? <span className="cfg-spinner" /> : <Glyph name="download" size={14} />}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
        {error && <div className="cfg-error cfg-error--small">{error}</div>}
      </section>
    </div>
  );
}
