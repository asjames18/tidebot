// First-run wizard step list (plan §2.2). Pure derivation from the
// GET /api/setup/status payload — no network, no model calls.
import type { SetupStatus } from '@shared/types';

export interface WizardStep {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action?: 'models' | 'create' | 'chat';
}

/**
 * The plan's five wizard steps, derived from the setup-status read.
 * Steps 1–3 reflect saved configuration. A provider can be configured
 * through the UI or environment, and compatible endpoints may run keyless.
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
        : 'Choose OpenRouter, xAI, or an OpenAI-compatible endpoint such as Ollama.',
      done: model,
      action: 'models',
    },
    {
      id: 'key',
      title: 'Add a key or enter a model URL',
      detail: model
        ? (status.provider === 'custom' ? 'Model endpoint configured.' : 'API key configured.')
        : 'Enter a provider key or the URL of your model endpoint in Settings.',
      done: model,
    },
    {
      id: 'test',
      title: 'Set up the model connection',
      detail: 'Use the connection test in Settings to check that the model responds.',
      done: model,
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
