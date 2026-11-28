// First-run wizard step list (plan §2.2). Pure derivation from the
// GET /api/setup/status payload — no network, no model calls.
import type { SetupStatus } from '@shared/types';

export interface WizardStep {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action: 'models' | 'create' | 'chat';
}

/**
 * The plan's five wizard steps, derived from the setup-status read.
 * Steps 1–3 share the modelConfigured signal: the connect flow only saves a
 * key after a successful test reply, so a configured model implies the
 * provider is chosen, the key is in, and the connection was tested. A key
 * that came from .env shows the same state — test it in Settings if unsure.
 * Step 4 (create an Operator) does not pick a template: template picks are
 * a maintainer decision (plan §16), so the wizard opens the normal create
 * flow and the user picks there.
 */
export function wizardSteps(status: SetupStatus): WizardStep[] {
  const model = status.modelConfigured;
  return [
    {
      id: 'provider',
      title: 'Choose a model provider',
      detail: model
        ? `Using ${status.provider} — ${status.defaultModel}.`
        : 'OpenRouter, xAI, or a local model via Ollama.',
      done: model,
      action: 'models',
    },
    {
      id: 'key',
      title: 'Add your key or point at Ollama',
      detail: model
        ? 'Key saved.'
        : 'Paste a key in Settings → Models, or point at a local model.',
      done: model,
      action: 'models',
    },
    {
      id: 'test',
      title: 'Test the connection',
      detail: model
        ? 'The connect flow only saves a key after a successful reply.'
        : 'TideBot sends a short test prompt before saving a key.',
      done: model,
      action: 'models',
    },
    {
      id: 'operator',
      title: 'Create your first Operator',
      detail: status.hasOperator
        ? 'You have an Operator.'
        : 'Pick a template or start blank.',
      done: status.hasOperator,
      action: 'create',
    },
    {
      id: 'run',
      title: 'Run a sample task',
      detail: status.hasCompletedRun
        ? 'Your first run finished.'
        : 'Ask your Operator to do something small, e.g. “Summarize this folder”.',
      done: status.hasCompletedRun,
      action: 'chat',
    },
  ];
}
