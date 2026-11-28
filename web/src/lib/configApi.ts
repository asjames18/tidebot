import type { AgentRun, Project, Row, Bot, ComputerState, LibraryFile, LlmConfigPublic, LlmProvider, Memory, ModelInfo, Routine, ShaderStyle, Skill, Task, Toolkit } from '@shared/types';
import { ApiError } from './api';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export interface BotSettingsBundle {
  memories: Memory[];
  skills: Skill[];
  routines: Routine[];
  tasks: Task[];
  memory: { lastConsolidatedAt: number | null; historyChars: number; compactAtChars: number; lastCompaction: { method: string; created_at: number } | null };
}

export interface LibraryListing { status: 'ok' | 'asleep' | 'error'; path: string; files: LibraryFile[]; error?: string }

export interface ComputerDetails {
  computer: ComputerState;
  screens: { botId: string; screenId: string; lastUsedAt: number }[];
  hibernation: { idleMinutes: number; viewers: number; dryRun: boolean };
}

export type BotPatch = Partial<Pick<Bot, 'name' | 'label' | 'description' | 'instructions' | 'avatarShape' | 'avatarColor' | 'effort' | 'mode' | 'model'>>;

export const configApi = {
  personalModel: () => req<{ active: boolean; hasKey: boolean; defaultModel: string; canInvite: boolean }>('GET', '/llm/personal'),
  savePersonalModel: (defaultModel: string, openrouterKey?: string) => req<{ active: boolean; hasKey: boolean; defaultModel: string; canInvite: boolean }>('PUT', '/llm/personal', { defaultModel, openrouterKey }),
  testPersonalModel: () => req<{ ok: boolean; model: string; error?: string }>('POST', '/llm/personal/test'),
  connectPersonalModel: (openrouterKey: string | undefined, defaultModel: string) =>
    req<{ ok: boolean; model: string; error?: string }>('POST', '/llm/personal/connect', { openrouterKey, defaultModel }),
  connectOrgo: (apiKey: string) => req<{ ok: boolean }>('POST', '/llm/connect-orgo', { apiKey }),
  llmConfig: () => req<LlmConfigPublic>('GET', '/llm/config'),
  studioLlmConfig: () => req<LlmConfigPublic>('GET', '/llm/config?scope=studio'),
  saveLlmConfig: (p: Partial<{ provider: LlmProvider; openrouterKey: string; xaiKey: string; customBaseUrl: string; customApiKey: string; defaultModel: string; shaderStyle: ShaderStyle; composioKey: string; orgoKey: string }>) =>
    req<LlmConfigPublic>('PUT', '/llm/config', p),
  testLlm: () => req<{ ok: boolean; model: string; provider: string; latencyMs: number; reply?: string; error?: string }>('POST', '/llm/test'),
  testComposio: () => req<{ ok: boolean; count?: number; latencyMs?: number; error?: string }>('POST', '/llm/test-composio'),
  enhancePrompt: (text: string, botName?: string, botRole?: string) => req<{ ok: boolean; text: string; error?: string }>('POST', '/llm/enhance', { text, botName, botRole }),
  modelsCatalog: () => req<{ curated: ModelInfo[]; remote: ModelInfo[] }>('GET', '/llm/models'),

  settings: (botId: string) => req<BotSettingsBundle>('GET', `/bots/${botId}/settings`),
  updateBot: (botId: string, p: BotPatch) => req<{ bot: Bot }>('PATCH', `/bots/${botId}`, p),
  deleteBot: (botId: string) => req<{ ok: true }>('DELETE', `/bots/${botId}`),
  makePrimary: (botId: string) => req<{ ok: true }>('POST', `/bots/${botId}/primary`),
  fresh: (botId: string) => req<{ ok: true }>('POST', `/bots/${botId}/fresh`),

  addMemory: (botId: string, text: string) => req<{ memory: Memory }>('POST', `/bots/${botId}/memories`, { text }),
  deleteMemory: (id: string) => req<{ ok: true }>('DELETE', `/memories/${id}`),
  consolidateMemories: (botId: string) => req<{ added: string[]; skipped: number; considered: number }>('POST', `/bots/${botId}/memories/consolidate`),
  compactHistory: (botId: string, force = true) => req<{ itemsBefore: number; itemsAfter: number; compacted: boolean }>('POST', `/bots/${botId}/compact${force ? '?force=1' : ''}`),

  createSkill: (botId: string, s: Pick<Skill, 'name' | 'description' | 'body'>) => req<{ skill: Skill }>('POST', `/bots/${botId}/skills`, s),
  updateSkill: (id: string, s: Partial<Pick<Skill, 'name' | 'description' | 'body'>>) => req<{ skill: Skill }>('PATCH', `/skills/${id}`, s),
  deleteSkill: (id: string) => req<{ ok: true }>('DELETE', `/skills/${id}`),

  createRoutine: (botId: string, r: { name: string; prompt: string; schedule: string; timezone?: string }) => req<{ routine: Routine }>('POST', `/bots/${botId}/routines`, r),
  updateRoutine: (id: string, r: Partial<{ name: string; prompt: string; schedule: string; timezone: string; enabled: boolean }>) => req<{ routine: Routine }>('PATCH', `/routines/${id}`, r),
  setRoutine: (id: string, enabled: boolean) => req<{ routine: Routine }>('PATCH', `/routines/${id}`, { enabled }),
  runRoutine: (id: string) => req<{ ok: true }>('POST', `/routines/${id}/run`),
  deleteRoutine: (id: string) => req<{ ok: true }>('DELETE', `/routines/${id}`),

  projects: () => req<{ projects: Project[] }>('GET', '/projects'),
  saveProject: (project: Project) => project.id
    ? req<{ project: Project }>('PUT', `/projects/${project.id}`, project)
    : req<{ project: Project }>('POST', '/projects', project),
  deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/projects/${id}`),

  startResearch: (botId: string, plan: { question: string; outline: string; links: string[]; files: string[] }) =>
    req<{ runId: string }>('POST', `/bots/${botId}/research`, plan),
  runs: (botId: string) => req<{ runs: AgentRun[] }>('GET', `/bots/${botId}/runs`),
  runDetails: (botId: string, runId: string) => req<{ run: AgentRun; rows: Row[] }>('GET', `/bots/${botId}/runs/${runId}`),

  tasks: () => req<{ tasks: Task[] }>('GET', '/tasks'),
  botTasks: (botId: string) => req<{ tasks: Task[] }>('GET', `/bots/${botId}/tasks`),
  createTask: (botId: string, t: { title: string; note?: string }) => req<{ task: Task }>('POST', `/bots/${botId}/tasks`, t),
  updateTask: (id: string, t: Partial<{ state: Task['state']; title: string; note: string | null }>) => req<{ task: Task }>('PATCH', `/tasks/${id}`, t),
  deleteTask: (id: string) => req<{ ok: true }>('DELETE', `/tasks/${id}`),

  checkins: () => req<{ enabled: boolean; times: string[]; timezone: string }>('GET', '/checkins'),
  setCheckins: (p: { enabled?: boolean; times?: string[]; timezone?: string }) => req<{ enabled: boolean; times: string[]; timezone: string }>('PUT', '/checkins', p),
  checkinNow: () => req<{ ok: true }>('POST', '/checkins/now'),

  files: (botId: string, path = '', wake = false) => req<LibraryListing>('GET', `/bots/${botId}/files?path=${encodeURIComponent(path)}${wake ? '&wake=1' : ''}`),
  localFiles: (botId: string) => req<LibraryListing>('GET', `/bots/${botId}/files?local=1`),
  fileContent: (botId: string, path: string) => req<{ ok: boolean; path: string; content: string }>('GET', `/bots/${botId}/files/content?path=${encodeURIComponent(path)}`),
  saveFile: (botId: string, path: string, content: string) => req<{ ok: boolean; path: string; size: number }>('POST', `/bots/${botId}/files`, { path, content }),
  deleteFile: (botId: string, path: string) => req<{ ok: boolean }>('DELETE', `/bots/${botId}/files?path=${encodeURIComponent(path)}`),
  downloadFile: (botId: string, path: string) => req<{ url: string }>('POST', `/bots/${botId}/files/download`, { path }),

  computerDetails: () => req<ComputerDetails>('GET', '/computer/details'),
  wake: () => req<{ computer: ComputerState }>('POST', '/computer/ensure'),
  sleep: () => req<{ computer: ComputerState }>('POST', '/computer/suspend'),
  resetScreen: (botId: string) => req<{ ok: true }>('POST', `/bots/${botId}/screen/reset`),

  policies: () => req<{ policies: { tool: string; mode: string }[] }>('GET', '/policies'),
  deletePolicy: (tool: string) => req<{ ok: true }>('DELETE', `/policies/${encodeURIComponent(tool)}`),

  connectedApps: () => req<{ connectedApps?: Toolkit[]; connected: string[] }>('GET', '/apps?limit=1'),
  logout: () => req<{ ok: true }>('POST', '/auth/logout'),
};
