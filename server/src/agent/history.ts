/**
 * Repair a Responses API history before sending it to the model.
 * If a turn was cut off mid-tool (server restart, interrupt, crash), the stored history can
 * contain function_call items with no matching function_call_output, which providers reject.
 * Synthetic outputs are appended after each contiguous tool-call batch (preserving parallel
 * tool-call grouping for Chat Completions providers). Calls listed in `pendingCallIds`
 * (waiting on a user approval) are left untouched when they are in the trailing tool batch
 * (including alongside sibling completed outputs); anywhere else they are repaired too.
 * Orphaned or duplicate function_call_output items without a preceding call are dropped.
 */
const INTERRUPTED_OUTPUT =
  'This tool call was interrupted before it finished (the run was stopped or restarted). Its result is unknown; check the current state before retrying.';

const isTrailingBatchItem = (x: any) =>
  x?.type === 'function_call' || x?.type === 'reasoning' || x?.type === 'function_call_output';

export function repairHistory(items: any[], pendingCallIds: Set<string> = new Set()): any[] {
  const clean = items.filter((it) => it != null);

  // Only count a function_call_output as answering a call if the call appeared before it.
  const seenCallIds = new Set<string>();
  const answeredCallIds = new Set<string>();
  for (const it of clean) {
    if (it.type === 'function_call' && typeof it.call_id === 'string' && it.call_id) {
      seenCallIds.add(it.call_id);
    } else if (it.type === 'function_call_output' && typeof it.call_id === 'string' && seenCallIds.has(it.call_id)) {
      answeredCallIds.add(it.call_id);
    }
  }

  const out: any[] = [];
  const emittedCalls = new Set<string>();
  const emittedOutputs = new Set<string>();
  let pendingSynthetic: string[] = [];

  const flushSynthetic = () => {
    for (const callId of pendingSynthetic) {
      if (emittedOutputs.has(callId)) continue;
      out.push({ type: 'function_call_output', call_id: callId, output: INTERRUPTED_OUTPUT });
      emittedOutputs.add(callId);
    }
    pendingSynthetic = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const it = clean[i];

    if (it.type === 'function_call') {
      out.push(it);
      const callId = typeof it.call_id === 'string' ? it.call_id : '';
      if (!callId) continue;
      emittedCalls.add(callId);
      if (answeredCallIds.has(callId) || emittedOutputs.has(callId)) continue;
      const inTrailingBatch = clean.slice(i + 1).every(isTrailingBatchItem);
      if (pendingCallIds.has(callId) && inTrailingBatch) continue;
      pendingSynthetic.push(callId);
      continue;
    }

    if (it.type !== 'reasoning') {
      flushSynthetic();
    }

    if (it.type === 'function_call_output') {
      const callId = typeof it.call_id === 'string' ? it.call_id : '';
      if (!callId || !emittedCalls.has(callId) || emittedOutputs.has(callId)) continue;
      emittedOutputs.add(callId);
      out.push(it);
      continue;
    }

    out.push(it);
  }

  flushSynthetic();
  return out;
}
