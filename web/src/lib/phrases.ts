import type { ActivityKind, LiveState, Row } from '@shared/types';

/** textKind → phrase table from docs/research/03-ui-design.md §2.4. Arrays rotate. */
const PHRASES: Record<string, string[]> = {
  thinking: ['Thinking it through', 'Mulling it over', 'Putting it together'],
  working: ['Getting it done', 'Making progress', 'Working on it', 'Handling it', 'Chipping away'],
  searching_web: ['Digging around'],
  reading_web: ['Doing some reading'],
  browsing_web: ['Clicking through pages'],
  reading_file: ['Reading the file'],
  drafting_file: ['Jotting it down'],
  organizing_files: ['Moving files over'],
  on_your_computer: ['Working on your computer'],
  on_its_computer: ['Clicking around'],
  running_commands: ['Running a few commands'],
  waiting_on_command: ['Waiting on results'],
  coding: ['Writing some code'],
  generating_photo: ['Sketching something up'],
  generating_video: ['Filming a clip'],
  messaging_assistant: ['Checking with another Bot'],
  messaging: ['Sending a message'],
  connecting_app: ['Working in a connected app'],
  waiting_for_you: ['Needs your input'],
  checking_usage: ['Checking your usage'],
  remembering: ['Making a note of it'],
};

const nice = (s?: string): string | null => {
  const trimmed = typeof s === 'string' ? s.trim() : '';
  return trimmed && !/[_]/.test(trimmed) && !/^[a-z0-9-]+$/.test(trimmed) ? trimmed : null;
};

/** Phrase for the activity line. `tick` rotates multi-phrase kinds. */
export function activityPhrase(live: LiveState, rows: Row[], tick: number): string {
  const a = live.activity;
  if (!a) return live.awaiting ? 'Needs your input' : 'Working on it';
  const kind = a.kind as ActivityKind;
  if (kind === 'messaging_named') {
    let botName: string | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const body = rows[i].body;
      if (body.type !== 'tool-call' || body.status !== 'running') continue;
      const args = body.args as Record<string, unknown> | undefined;
      if (typeof args?.bot_name === 'string' && args.bot_name.trim()) {
        botName = args.bot_name.trim();
        break;
      }
    }
    const name = botName ?? nice(a.detail);
    return name ? `Checking with ${name}` : 'Checking with another Bot';
  }
  if (kind === 'connecting_service') {
    const service = nice(a.detail);
    return service ? `Working in ${service}` : 'Working in a connected app';
  }
  const list = Object.hasOwn(PHRASES, kind) ? PHRASES[kind] : PHRASES.working;
  const idx = Number.isFinite(tick) ? Math.max(0, Math.trunc(tick)) % list.length : 0;
  return list[idx];
}
