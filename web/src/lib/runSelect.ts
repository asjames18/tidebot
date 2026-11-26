import type { AgentRun } from '@shared/types';

/**
 * When the Runs tab opens with nothing selected, jump straight to a run
 * that is waiting on the user (issue #5: keep pending approvals visible
 * from chat). The chat run-status bar's "View runs" action lands here, so
 * the approval card is one tap away instead of a list the user must dig
 * through. Returns the run id to select, or undefined to stay on the list.
 */
export function pickInitialSelectedRun(
  runs: AgentRun[],
  selected: string | undefined,
): string | undefined {
  if (selected) return undefined;
  return runs.find((run) => run.state === 'waiting')?.id;
}
