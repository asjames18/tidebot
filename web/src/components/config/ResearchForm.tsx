import { useEffect, useId, useState, type FormEvent } from 'react';
import { configApi } from '../../lib/configApi';

const DEFAULT_OUTLINE = 'Summarize each source. Compare where they agree or differ. Note gaps and give a short conclusion.';
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

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
  useEffect(() => {
    let active = true;
    void configApi.localFiles(botId).then(({ files }) => {
      if (active) setAvailableFiles(files.filter((file) => !file.isDir && /\.(?:md|txt|csv|json)$/i.test(file.name)).map((file) => file.name));
    }).catch(() => {});
    return () => { active = false; };
  }, [botId]);
  const sources = lines(links).length + lines(files).length;

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await configApi.startResearch(botId, {
        question, outline, links: lines(links), files: lines(files),
      });
      onStart(result.runId);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
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
    {availableFiles.length > 0 && <div className="research-field">
      <label htmlFor={`${formId}-file`}>Add a Library file</label>
      <select id={`${formId}-file`} className="text-input" value="" disabled={sources >= 8} onChange={(e) => setFiles((value) => [...lines(value), e.target.value].join('\n'))}>
        <option value="" disabled>Choose a file</option>
        {availableFiles.filter((name) => !lines(files).includes(name)).map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    </div>}
    <label>
      Library file paths, one per line
      <textarea className="text-input cfg-textarea" rows={2} spellCheck={false} value={files} onChange={(e) => setFiles(e.target.value)} />
    </label>
    <p>{sources} of 8 sources. Selected excerpts are sent to your current model.</p>
    {error && <p role="alert">{error}</p>}
    <div className="cfg-editor__actions">
      <button type="button" className="cfg-btn cfg-btn--secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="submit" className="cfg-btn cfg-btn--primary"
        disabled={busy || !question.trim() || !outline.trim() || sources < 1 || sources > 8}>
        {busy ? 'Starting…' : 'Start research'}
      </button>
    </div>
  </form>;
}
