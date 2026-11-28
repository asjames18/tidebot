import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { configApi } from '../../lib/configApi';
import {
  appendResearchFile,
  buildResearchPayload,
  filterSelectableResearchFiles,
  MAX_RESEARCH_SOURCES,
  parseSourceLines,
} from '../../lib/researchForm';

const DEFAULT_OUTLINE = 'Summarize each source. Compare where they agree or differ. Note gaps and give a short conclusion.';

export function ResearchForm({ botId, onStart, onCancel }: {
  botId: string;
  onStart: (id: string) => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const [question, setQuestion] = useState('');
  const [outline, setOutline] = useState(DEFAULT_OUTLINE);
  const [links, setLinks] = useState('');
  const [files, setFiles] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const mountedRef = useRef(true);
  const activeBotIdRef = useRef(botId);
  const submitGenRef = useRef(0);
  activeBotIdRef.current = botId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submitGenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let active = true;
    submitGenRef.current += 1;
    setAvailableFiles([]);
    setError('');
    setBusy(false);
    void configApi.localFiles(botId).then(({ files: entries }) => {
      if (active) setAvailableFiles(filterSelectableResearchFiles(entries));
    }).catch(() => {});
    return () => { active = false; };
  }, [botId]);

  const selectedFiles = parseSourceLines(files);
  const remainingFiles = availableFiles.filter((name) => !selectedFiles.includes(name));
  const sources = parseSourceLines(links).length + selectedFiles.length;
  const payload = buildResearchPayload({ question, outline, links, files });

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !payload) return;
    const targetBotId = botId;
    const gen = ++submitGenRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await configApi.startResearch(targetBotId, payload);
      if (mountedRef.current && submitGenRef.current === gen && activeBotIdRef.current === targetBotId) {
        onStart(result.runId);
      }
    } catch (err) {
      if (mountedRef.current && submitGenRef.current === gen && activeBotIdRef.current === targetBotId) {
        setError((err as Error).message);
        setBusy(false);
      }
    }
  };

  return <form className="cfg-editor research-form" onSubmit={start}>
    <div className="research-field">
      <label htmlFor={`${formId}-question`}>Research question</label>
      <input id={`${formId}-question`} required maxLength={500} className="text-input" value={question} onChange={(e) => setQuestion(e.target.value)} />
    </div>
    <div className="research-field">
      <label htmlFor={`${formId}-plan`}>Plan</label>
      <textarea id={`${formId}-plan`} required maxLength={2000} rows={3} className="text-input cfg-textarea" value={outline} onChange={(e) => setOutline(e.target.value)} />
    </div>
    <label>
      Web links, one per line
      <textarea className="text-input cfg-textarea" rows={3} spellCheck={false} value={links} onChange={(e) => setLinks(e.target.value)} />
    </label>
    {remainingFiles.length > 0 && <div className="research-field">
      <label htmlFor={`${formId}-file`}>Add a Library file</label>
      <select
        id={`${formId}-file`}
        className="text-input"
        value=""
        disabled={busy || sources >= MAX_RESEARCH_SOURCES}
        onChange={(e) => setFiles((value) => appendResearchFile(value, e.target.value))}
      >
        <option value="" disabled>Choose a file</option>
        {remainingFiles.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    </div>}
    <label>
      Library file paths, one per line
      <textarea className="text-input cfg-textarea" rows={2} spellCheck={false} value={files} onChange={(e) => setFiles(e.target.value)} />
    </label>
    <p>{sources} of {MAX_RESEARCH_SOURCES} sources. Selected excerpts are sent to your current model.</p>
    {error && <p role="alert">{error}</p>}
    <div className="cfg-editor__actions">
      <button type="button" className="cfg-btn cfg-btn--secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="submit" className="cfg-btn cfg-btn--primary" disabled={busy || !payload}>
        {busy ? 'Starting…' : 'Start research'}
      </button>
    </div>
  </form>;
}
