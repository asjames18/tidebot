import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bot, LibraryFile } from '@shared/types';
import { configApi, type LibraryListing } from '../../lib/configApi';
import { copyText } from '../../lib/clipboard';
import { RequestGate, isMarkdownFilename, joinLibraryPath, sanitizeLibraryFilename } from '../../lib/libraryPath';
import { relativeShort } from '../../lib/time';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { Markdown } from '../Markdown';
import { Glyph } from './glyphs';
import { ConfirmButton, formatBytes } from './ui';

/** Files the bot saved under its workspace or /root/grokbot/files/<botId>. */
export function LibraryTab({ bot }: { bot: Bot }) {
  const awake = useStore((s) => s.computer?.status === 'running');
  // Scope folder path to bot.id so switching bots immediately resolves to '' on the first render.
  const [loc, setLoc] = useState<{ botId: string; path: string }>({ botId: bot.id, path: '' });
  const path = loc.botId === bot.id ? loc.path : '';
  const setPath = (next: string) => {
    fileGateRef.current.invalidate();
    setLoc({ botId: bot.id, path: next });
  };
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
  const copyTimerRef = useRef<number | null>(null);
  const listGateRef = useRef(new RequestGate());
  const fileGateRef = useRef(new RequestGate());
  useEffect(() => () => {
    listGateRef.current.invalidate();
    fileGateRef.current.invalidate();
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);
  useEffect(() => {
    setCopied(false);
    if (copyTimerRef.current) { window.clearTimeout(copyTimerRef.current); copyTimerRef.current = null; }
  }, [preview?.rel]);

  const load = useCallback(async (wake = false) => {
    const reqId = listGateRef.current.next();
    setLoading(true); setError(null);
    try {
      const next = await configApi.files(bot.id, path, wake);
      if (listGateRef.current.isCurrent(reqId)) setList(next);
    } catch (e) {
      if (listGateRef.current.isCurrent(reqId)) setError((e as Error).message);
    } finally {
      if (listGateRef.current.isCurrent(reqId)) setLoading(false);
    }
  }, [bot.id, path]);

  useEffect(() => {
    listGateRef.current.invalidate();
    fileGateRef.current.invalidate();
    setLoc({ botId: bot.id, path: '' });
    setList(null);
    setPreview(null);
    setCreating(false);
    setBusyFile(null);
    setError(null);
  }, [bot.id]);
  useEffect(() => { load(); }, [load, awake]);

  const download = async (f: LibraryFile) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    const reqId = fileGateRef.current.next();
    const rel = joinLibraryPath(path, f.name);
    setBusyFile(f.name); setError(null);
    try {
      const { url } = await configApi.downloadFile(bot.id, rel);
      if (!fileGateRef.current.isCurrent(reqId)) return;
      const a = document.createElement('a');
      a.href = url; a.download = f.name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      if (fileGateRef.current.isCurrent(reqId)) setError(`Couldn’t download ${f.name}: ${(e as Error).message}`);
    } finally {
      if (fileGateRef.current.isCurrent(reqId)) setBusyFile(null);
    }
  };

  const openFile = async (f: LibraryFile) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    const reqId = fileGateRef.current.next();
    const rel = joinLibraryPath(path, f.name);
    setBusyFile(f.name); setError(null);
    try {
      const res = await configApi.fileContent(bot.id, rel);
      if (!fileGateRef.current.isCurrent(reqId)) return;
      setPreview({ name: f.name, rel, content: res.content, editing: false });
    } catch {
      if (!fileGateRef.current.isCurrent(reqId)) return;
      await download(f);
    } finally {
      if (fileGateRef.current.isCurrent(reqId)) setBusyFile(null);
    }
  };

  const blurActiveOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
    }
  };

  const savePreviewEdit = async () => {
    if (!preview || busyFile === preview.name) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
    const reqId = fileGateRef.current.next();
    const snapshot = preview;
    setBusyFile(snapshot.name);
    try {
      await configApi.saveFile(bot.id, snapshot.rel, snapshot.content);
      if (!fileGateRef.current.isCurrent(reqId)) return;
      blurActiveOnMobile();
      setPreview({ ...snapshot, editing: false });
      await load();
    } catch (e) {
      if (fileGateRef.current.isCurrent(reqId)) setError((e as Error).message);
    } finally {
      if (fileGateRef.current.isCurrent(reqId)) setBusyFile(null);
    }
  };

  const createNewFile = async () => {
    const clean = sanitizeLibraryFilename(newFilename);
    if (!clean || loading) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
    const reqId = fileGateRef.current.next();
    const rel = joinLibraryPath(path, clean);
    setLoading(true);
    try {
      await configApi.saveFile(bot.id, rel, newContent);
      if (!fileGateRef.current.isCurrent(reqId)) return;
      blurActiveOnMobile();
      setCreating(false);
      setNewFilename('notes.md');
      setNewContent('');
      await load();
    } catch (e) {
      if (fileGateRef.current.isCurrent(reqId)) setError((e as Error).message);
    } finally {
      if (fileGateRef.current.isCurrent(reqId)) setLoading(false);
    }
  };

  const removeFile = async (rel: string) => {
    const reqId = fileGateRef.current.next();
    try {
      await configApi.deleteFile(bot.id, rel);
      if (!fileGateRef.current.isCurrent(reqId)) return;
      if (preview?.rel === rel) setPreview(null);
      await load();
    } catch (e) {
      if (fileGateRef.current.isCurrent(reqId)) setError((e as Error).message);
    }
  };

  const crumbs = path ? path.split('/') : [];
  const validNewFilename = Boolean(sanitizeLibraryFilename(newFilename));

  return (
    <div className="details__sections">
      <section>
        <div className="section-label section-label--row">
          <span className="lib-crumbs">
            {crumbs.length ? (
              <>
                <button
                  type="button"
                  className="link-btn link-btn--small"
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch {} }
                    setPreview(null);
                    setPath('');
                  }}
                >
                  Files
                </button>
                {crumbs.map((c, i) => (
                  <span key={i} className="lib-crumbs__part">
                    <Icon name="chev_right" size={8} opacity={0.5} />
                    <button
                      type="button"
                      className="link-btn link-btn--small"
                      onClick={() => {
                        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch {} }
                        setPreview(null);
                        setPath(crumbs.slice(0, i + 1).join('/'));
                      }}
                    >
                      {c}
                    </button>
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
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              aria-label="New file name"
              placeholder="filename.md"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
            />
            <textarea
              className="cfg-textarea"
              rows={5}
              aria-label="File contents"
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
              <button
                type="button"
                className="cfg-btn cfg-btn--primary"
                disabled={loading || !validNewFilename}
                onClick={() => void createNewFile()}
              >
                {loading ? 'Saving…' : 'Save File'}
              </button>
            </div>
          </div>
        )}

        {preview && (
          <div className="panel-card" style={{ padding: 10, gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
              <strong style={{ fontSize: 12.5, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 0' }}>
                {preview.name}
              </strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="link-btn link-btn--small"
                  onClick={() => {
                    void copyText(preview.content).then((ok) => {
                      if (!ok) {
                        useStore.getState().notify('Could not copy file contents');
                        return;
                      }
                      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
                      setCopied(true);
                      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
                      copyTimerRef.current = window.setTimeout(() => { setCopied(false); copyTimerRef.current = null; }, 1400);
                    });
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
                  aria-label="Edit file contents"
                  value={preview.content}
                  onChange={(e) => setPreview({ ...preview, content: e.target.value })}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <ConfirmButton confirmLabel="Confirm delete" onConfirm={() => removeFile(preview.rel)}>Delete</ConfirmButton>
                  <button
                    type="button"
                    className="cfg-btn cfg-btn--primary"
                    disabled={busyFile === preview.name}
                    onClick={() => void savePreviewEdit()}
                  >
                    {busyFile === preview.name ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </>
            ) : isMarkdownFilename(preview.name) ? (
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
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
                  load(true);
                }}
                disabled={loading}
              >
                {loading ? 'Waking…' : 'Wake cloud computer'}
              </button>
            </div>
          ) : !list && loading ? (
            <div className="panel-empty">Looking for files…</div>
          ) : list?.status === 'error' || (!list && error) ? (
            <div className="lib-empty">
              <div>Couldn’t load files. {(list?.error ?? error) ? <span className="lib-err">{list?.error ?? error}</span> : null}</div>
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                disabled={loading}
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                  load();
                }}
              >
                {loading ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          ) : !list?.files.length ? (
            <div className="panel-empty panel-empty--center">{path ? 'This folder is empty.' : `Deliverables that ${bot.name} creates (reports, code, markdown) are kept here.`}</div>
          ) : (
            list.files.map((f) => {
              const rel = path ? `${path}/${f.name}` : f.name;
              return (
                <div key={f.name} className={`lib-row${f.isDir ? ' is-dir' : ''}`}>
                  <button
                    type="button"
                    className="lib-row__main"
                    disabled={!f.isDir && busyFile === f.name}
                    onClick={() => {
                      if (f.isDir) {
                        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch {} }
                        setPreview(null);
                        setPath(rel);
                      } else {
                        openFile(f);
                      }
                    }}
                    title={f.isDir ? `Open ${f.name}` : `Preview ${f.name}`}
                  >
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
        {error && <div className="cfg-error cfg-error--small" role="alert">{error}</div>}
      </section>
    </div>
  );
}
