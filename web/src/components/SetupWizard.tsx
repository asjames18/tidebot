import { useCallback, useEffect, useState } from 'react';
import { configApi } from '../lib/configApi';
import { wizardSteps } from '../lib/setupWizard';
import { useConfigUI } from '../configStore';
import { useStore } from '../store';
import { Modal } from './modals/Modal';
import type { SetupStatus } from '@shared/types';

const DISMISS_KEY = 'tidebot.setup-wizard-dismissed';

/**
 * First-run wizard (plan §2.2): a five-step checklist driven by
 * GET /api/setup/status. While setup is incomplete a floating "Finish setup"
 * pill opens it; Skip dismisses it for good. Skippable and resumable — the
 * status is re-read every time it opens.
 */
export function SetupWizard() {
  const userId = useStore((s) => s.user?.id);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  const refresh = useCallback(() => {
    if (!userId) return;
    setFailed(false);
    configApi.setupStatus()
      .then((value) => setStatus(value))
      .catch(() => setFailed(true));
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* wizard stays available */ }
  }, []);

  const goModels = useCallback(() => {
    setOpen(false);
    useConfigUI.getState().openAppSettings('models');
  }, []);

  const goCreate = useCallback(() => {
    setOpen(false);
    useStore.getState().setModal('create');
  }, []);

  if (!userId || !status || status.setupComplete || dismissed) return null;
  const steps = wizardSteps(status);
  const done = steps.filter((s) => s.done).length;

  return <>
    {!open && (
      <button
        type="button"
        className="cfg-btn cfg-btn--primary"
        onClick={() => { refresh(); setOpen(true); }}
        style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 60, borderRadius: 999, padding: '10px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}
      >
        Finish setup · {done}/{steps.length}
      </button>
    )}
    {open && (
      <Modal onClose={() => setOpen(false)} className="setup-wizard" label="Finish setup">
        <div className="modal__header">
          <h2 className="modal__title">Finish setup</h2>
          <button type="button" className="modal__close" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <p style={{ margin: '0 0 12px' }}>Five quick steps to a working first Operator. You can skip any time — your progress is saved.</p>
        {failed && <div className="cfg-error">
          <p role="alert">Could not refresh setup progress.</p>
          <button type="button" className="cfg-btn cfg-btn--secondary" onClick={refresh}>Retry setup progress</button>
        </div>}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {steps.map((step) => (
            <li key={step.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1.4 }}>{step.done ? '✓' : '○'}</span>
              <div style={{ flex: 1, display: 'grid', gap: 4 }}>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
                {!step.done && step.action === 'models' && <span><button type="button" className="cfg-btn" onClick={goModels}>Open model settings</button></span>}
                {!step.done && step.action === 'create' && <span><button type="button" className="cfg-btn" onClick={goCreate}>Create an Operator</button></span>}
                {!step.done && step.action === 'chat' && <span><button type="button" className="cfg-btn" onClick={() => setOpen(false)}>Start chatting</button></span>}
              </div>
            </li>
          ))}
        </ol>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="cfg-btn" onClick={dismiss}>Skip setup</button>
        </div>
      </Modal>
    )}
  </>;
}
