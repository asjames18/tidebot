import { useEffect, useState } from 'react';
import { useConfigUI } from '../../configStore';
import { configApi } from '../../lib/configApi';
import { useStore } from '../../store';

export function SetupSection() {
  const open = useConfigUI((s) => s.openAppSettings);
  const close = useConfigUI((s) => s.closeAppSettings);
  const refresh = useConfigUI((s) => s.loadLlmConfig);
  const config = useConfigUI((s) => s.llmConfig);
  const [account, setAccount] = useState<Awaited<ReturnType<typeof configApi.personalModel>>>();
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [orgoKey, setOrgoKey] = useState('');
  const [orgoBusy, setOrgoBusy] = useState(false);
  const [orgoResult, setOrgoResult] = useState<{ ok: boolean; message: string }>();
  const [result, setResult] = useState<{ ok: boolean; message: string }>();

  useEffect(() => {
    let active = true;
    void configApi.personalModel().then((value) => {
      if (active) { setAccount(value); setModel(value.defaultModel); }
    }).catch((error: Error) => { if (active) setResult({ ok: false, message: error.message }); });
    return () => { active = false; };
  }, []);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setResult(undefined);
    try {
      const response = key.trim()
        ? await configApi.connectPersonalModel(key.trim(), model.trim())
        : await configApi.testPersonalModel();
      if (!response.ok) {
        setResult({ ok: false, message: response.error ?? 'OpenRouter did not respond. Check the key and model, then try again.' });
        return;
      }
      setKey('');
      setResult({ ok: true, message: `Verified a reply using ${response.model}.` });
      await Promise.all([
        configApi.personalModel().then(setAccount),
        refresh(),
        useStore.getState().checkAuth(),
      ]);
    } catch (error) {
      setResult({ ok: false, message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return <>
    <div className="app-settings__head">
      <h1>Connect a model</h1>
      <p>Use your own OpenRouter key or connect a model running on your hardware.</p>
    </div>
    <section className="cfg-section">
      <h2 className="cfg-section__label">OpenRouter</h2>
      {config?.isConfigured && <p className="cfg-row__sub">Current model: {config.defaultModel} ({config.provider}).</p>}
      {account && <form className="signin__dev" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
        <label className="cfg-field" htmlFor="setup-openrouter">
          <span className="cfg-field__label">Your OpenRouter API key</span>
          <input id="setup-openrouter" className="text-input" type="password" autoComplete="off"
            placeholder={account.hasKey ? 'Key already saved' : 'sk-or-v1-…'} value={key} onChange={(event) => setKey(event.target.value)} />
        </label>
        <a className="cfg-field__hint" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">Create a key at OpenRouter ↗</a>
        <label className="cfg-field" htmlFor="setup-model">
          <span className="cfg-field__label">Default model</span>
          <input id="setup-model" className="text-input" value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <p className="cfg-field__hint">TideBot sends a short test prompt and saves a new key only after a successful reply. OpenRouter may charge for model usage.</p>
        <button className="cfg-btn cfg-btn--primary" type="submit" disabled={busy || (!key.trim() && !account.hasKey)}>
          {busy ? 'Testing…' : account.hasKey && !key.trim() ? 'Test saved key' : 'Connect and test OpenRouter'}
        </button>
      </form>}
      {result && <p className={`byom-status ${result.ok ? 'is-ok' : 'is-err'}`} role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
    </section>
    <section className="cfg-section">
      <h2 className="cfg-section__label">{account?.canManageStudio ? 'Local or shared model' : 'Studio model'}</h2>
      <button className="cfg-btn cfg-btn--secondary" onClick={() => open('models')}>
        Open model settings
      </button>
    </section>
    <details className="cfg-section setup-optional">
      <summary>Optional services</summary>
      <div className="cfg-card">
        <div className="cfg-row">
          <div className="cfg-row__text">
            <div className="cfg-row__title">Connected apps and Google sign-in</div>
            <div className="cfg-row__sub">{config?.hasComposioKey ? 'Composio key configured. Connect individual apps when you need them.' : account?.canManageStudio ? 'Add your Composio key to connect apps and enable Google sign-in.' : 'The studio owner or administrator manages the Composio key.'}</div>
          </div>
          <button className="cfg-btn cfg-btn--secondary" onClick={() => open('apps')}>Connected apps</button>
        </div>
        <div className="cfg-row">
          <div className="cfg-row__text">
            <div className="cfg-row__title">Cloud desktop</div>
            <div className="cfg-row__sub">{config?.hasOrgoKey ? 'Orgo key configured.' : 'Basic chat and local workspace files work without a cloud desktop.'}</div>
          </div>
          <button className="cfg-btn cfg-btn--secondary" onClick={() => open('computer')}>Computer settings</button>
        </div>
        {account?.canManageStudio && <div className="cfg-row">
          <form className="cfg-field" onSubmit={async (event) => {
            event.preventDefault();
            if (orgoBusy) return;
            setOrgoBusy(true);
            setOrgoResult(undefined);
            try {
              await configApi.connectOrgo(orgoKey.trim());
              setOrgoKey('');
              setOrgoResult({ ok: true, message: 'Orgo workspace access verified. No computer was started.' });
              await refresh();
            } catch (error) { setOrgoResult({ ok: false, message: (error as Error).message }); }
            finally { setOrgoBusy(false); }
          }}>
            <label className="cfg-field__label" htmlFor="setup-orgo">Orgo API key</label>
            <input id="setup-orgo" className="text-input" type="password" autoComplete="off" value={orgoKey} onChange={(event) => setOrgoKey(event.target.value)} />
            <button className="cfg-btn cfg-btn--secondary" disabled={orgoBusy || !orgoKey.trim()}>{orgoBusy ? 'Testing…' : 'Connect Orgo'}</button>
            {orgoResult && <p role={orgoResult.ok ? 'status' : 'alert'} className="cfg-row__sub">{orgoResult.message}</p>}
          </form>
        </div>}
        <div className="cfg-row">
          <div className="cfg-row__text">
            <div className="cfg-row__title">xAI voice</div>
            <div className="cfg-row__sub">Available with an xAI key for accounts that use studio model settings.</div>
          </div>
          {account?.canManageStudio && <button className="cfg-btn cfg-btn--secondary" onClick={() => open('models')}>Studio model settings</button>}
        </div>
      </div>
    </details>
    <button className="cfg-btn cfg-btn--secondary" onClick={close}>{config?.isConfigured ? 'Go to studio' : 'Continue without a model'}</button>
  </>;
}
