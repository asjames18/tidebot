import { useEffect, useState } from 'react';
import type { AgentRun, Row } from '@shared/types';
import { useConfigUI, useVersion } from '../../configStore';
import { gitReviewLauncher } from '../../lib/desktop';
import { configApi } from '../../lib/configApi';
import { formatUsageSummary } from '../../lib/usageFormat';
import { useStore } from '../../store';
import { Markdown } from '../Markdown';
import { ResearchForm } from './ResearchForm';
import { ApprovalCard } from '../cards/Cards';

const states: Record<AgentRun['state'], string> = {
  queued: 'Queued', running: 'Running', waiting: 'Waiting for approval', completed: 'Completed',
  failed: 'Failed', interrupted: 'Interrupted',
};
const sources: Record<AgentRun['source'], string> = {
  chat: 'Chat', 'manual-routine': 'Run now', schedule: 'Schedule', event: 'Event', research: 'Research',
};

function RunOutput({ row, download }: { row: Row; download: (path: string) => void }) {
  const { body } = row;
  if (body.type === 'message') {
    const file = body.artifactPath;
    return <>
      {body.text && <Markdown text={body.text} allowImages={!file} />}
      {file && <button type="button" className="link-btn" onClick={() => download(file)}>Download report</button>}
    </>;
  }
  if (body.type === 'tool-call') {
    const file = body.artifactPath;
    return <div className="run-history__step">
      <span>{body.label}</span>
      <small>{body.summary || body.status.replace(/-/g, ' ')}</small>
      {file && <button type="button" className="link-btn" onClick={() => download(file)}>
        Download {file}
      </button>}
    </div>;
  }
  if (body.type === 'card' && body.card === 'approval') return <ApprovalCard body={body} />;
  if (body.type === 'notice' || body.type === 'event') return <p>{body.text}</p>;
  return null;
}

export function RunHistory({ botId, openLibrary }: { botId: string; openLibrary: () => void }) {
  const connected = useStore((s) => s.sseConnected);
  const [runs, setRuns] = useState<AgentRun[]>();
  const [selected, setSelected] = useState<string>();
  const [planning, setPlanning] = useState(false);
  const [detail, setDetail] = useState<{ run: AgentRun; rows: Row[] }>();
  const [error, setError] = useState('');
  const versionKey = `runs:${botId}`;
  const version = useVersion(versionKey);

  useEffect(() => {
    let active = true;
    const request = selected
      ? configApi.runDetails(botId, selected).then((value) => { if (active) setDetail(value); })
      : configApi.runs(botId).then((value) => { if (active) setRuns(value.runs); });
    void request.then(() => { if (active) setError(''); })
      .catch((err: Error) => { if (active) { setDetail(undefined); setError(err.message); } });
    return () => { active = false; };
  }, [botId, selected, version, connected]);

  const download = async (path: string) => {
    try {
      const { url } = await configApi.downloadFile(botId, path);
      const link = document.createElement('a');
      link.href = url;
      link.download = path;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      useStore.getState().notify((err as Error).message);
    }
  };

  const openGitReview = gitReviewLauncher();
  const request = detail?.rows.find((row) => row.body.type === 'message' && row.body.role === 'user')?.body;
  const prompt = request?.type === 'message' && detail?.run.state === 'completed' ? request.text : '';
  const detailUsage = detail ? formatUsageSummary(detail.run.usage) : null;

  return <section className="details__sections run-history" aria-label="Run history">
    <div className="section-label section-label--row">
      <span>{selected ? 'Run details' : 'Run history'}</span>
      {selected ? <button type="button" className="link-btn" onClick={() => { setError(''); setSelected(undefined); }}>All runs</button>
        : !planning && <div className="run-history__actions">
          <button type="button" className="link-btn" onClick={() => setPlanning(true)}>New research</button>
          <button type="button" className="link-btn" onClick={() => useConfigUI.getState().bump(versionKey)}>Refresh</button>
        </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    {planning ? <ResearchForm botId={botId} onCancel={() => setPlanning(false)} onStart={(id) => {
      setError('');
      setDetail(undefined);
      setPlanning(false);
      setSelected(id);
    }} /> : selected ? detail?.run.id === selected && <>
      <div className="run-history__summary">
        <strong>{detail.run.title}</strong>
        <span>{states[detail.run.state]}</span>
        {detailUsage && (
          <p className="panel-row__sub" style={{ margin: '4px 0 0' }}>
            {detailUsage.tokens} · {detailUsage.cost}
            {detailUsage.note ? ` (${detailUsage.note})` : ''}
          </p>
        )}
        {detail.run.summary && <p>{detail.run.summary}</p>}
        <div className="run-history__actions">
          {prompt && <button type="button" className="link-btn" onClick={() =>
            useConfigUI.getState().openBotSettings(botId, 'routines', { name: detail.run.title, prompt })
          }>Save as routine</button>}
          <button type="button" className="link-btn" onClick={openLibrary}>Workspace Library</button>
          {openGitReview && <button type="button" className="link-btn" onClick={() => void openGitReview()}>Git Review</button>}
        </div>
      </div>
      <div className="run-history__output">
        {detail.rows.map((row) => <RunOutput key={row.seq} row={row} download={(path) => void download(path)} />)}
        {!detail.rows.length && <p>No output recorded for this run.</p>}
      </div>
    </> : runs?.length ? <ul className="panel-card run-history__list">
      {runs.map((run) => {
        const u = run.usage && run.usage.calls > 0 ? formatUsageSummary(run.usage) : null;
        return <li key={run.id}>
          <button type="button" className="panel-row run-history__item" onClick={() => {
            setError('');
            setDetail(undefined);
            setSelected(run.id);
          }}>
            <span className="panel-row__text">
              <span className="panel-row__title">{run.title}</span>
              <span className="panel-row__sub">
                {sources[run.source]} · {new Date(run.createdAt).toLocaleString()}
                {u ? ` · ${u.inline}` : ''}
              </span>
            </span>
            <span className="run-history__state">{states[run.state]}</span>
          </button>
        </li>;
      })}
    </ul> : <p>{runs ? 'Chat with this bot or run a routine to see its history here.' : 'Loading runs…'}</p>}
  </section>;
}
