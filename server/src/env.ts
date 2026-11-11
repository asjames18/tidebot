import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
let lastMtimeMs = -1;
let diskEnv: Record<string, string> = {};

export function reloadEnvFromDisk(): Record<string, string> {
  try {
    const st = fs.statSync(envFilePath);
    if (st.mtimeMs !== lastMtimeMs) {
      lastMtimeMs = st.mtimeMs;
      const raw = fs.readFileSync(envFilePath, 'utf8');
      const parsed: Record<string, string> = {};
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        parsed[key] = val;
        process.env[key] = val;
      }
      diskEnv = parsed;
    }
  } catch {
    // ignore if .env doesn't exist
  }
  return diskEnv;
}

// Initial load on startup
reloadEnvFromDisk();

export function writeEnvKeyToDisk(key: string, value: string) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid env key: ${key}`);
  if (/[\r\n\0]/.test(value)) throw new Error('Env values must not contain newlines');
  try {
    const raw = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    const lines = raw.split(/\r?\n/);
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
    fs.writeFileSync(envFilePath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(envFilePath, 0o600); } catch { /* best effort */ }
    lastMtimeMs = -1;
    reloadEnvFromDisk();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Env values')) throw e;
    diskEnv[key] = value;
    process.env[key] = value;
  }
}

function opt(name: string, fallback = ''): string {
  reloadEnvFromDisk();
  const v = (diskEnv[name] ?? process.env[name])?.trim();
  return v || fallback;
}

const sessionSecretInit = opt('SESSION_SECRET', crypto.randomBytes(32).toString('hex'));

export const env = {
  get port() { return Number(opt('PORT', '8787')); },
  get host() { return opt('HOST', '127.0.0.1'); },
  get appUrl() { return opt('APP_URL', 'http://localhost:5173'); },
  /** Public URL of this server, used for OAuth callbacks. */
  get serverUrl() { return opt('SERVER_URL', `http://localhost:${opt('PORT', '8787')}`); },
  get llmProvider(): 'openrouter' | 'custom' | 'xai' {
    const orKey = opt('OPENROUTER_API_KEY');
    const cUrl = opt('LLM_BASE_URL');
    const xKey = opt('XAI_API_KEY');
    return opt('LLM_PROVIDER', orKey ? 'openrouter' : cUrl ? 'custom' : xKey ? 'xai' : 'openrouter') as 'openrouter' | 'custom' | 'xai';
  },
  get openrouterKey() { return opt('OPENROUTER_API_KEY'); },
  get openrouterModel() { return opt('OPENROUTER_MODEL', 'thinkingmachines/inkling-2-small:free'); },
  get customBaseUrl() { return opt('LLM_BASE_URL'); },
  get customApiKey() { return opt('LLM_API_KEY'); },
  get customModel() { return opt('LLM_MODEL'); },
  get xaiKey() { return opt('XAI_API_KEY'); },
  get xaiModel() { return opt('XAI_MODEL', 'grok-4.7'); },
  get composioKey() { return opt('COMPOSIO_API_KEY'); },
  get orgoKey() { return opt('ORGO_API_KEY'); },
  /** Orgo workspace that holds every user's box. */
  get orgoWorkspaceId() { return opt('ORGO_WORKSPACE_ID'); },
  set orgoWorkspaceId(val: string) { diskEnv.ORGO_WORKSPACE_ID = val; process.env.ORGO_WORKSPACE_ID = val; },
  /** Orgo box size for new users. */
  get orgoRamGb() { return Number(opt('ORGO_RAM_GB', '8')); },
  get orgoCpu() { return Number(opt('ORGO_CPU', '2')); },
  get orgoResolution() { return opt('ORGO_RESOLUTION', '1280x800x24'); },
  sessionSecret: sessionSecretInit,
  get devLogin() { return opt('DEV_LOGIN') === '1'; },
  dbPath: process.env.DB_PATH ?? new URL('../../data/grokbot.db', import.meta.url).pathname,
  get providers() {
    return {
      openrouter: Boolean(opt('OPENROUTER_API_KEY')),
      custom: Boolean(opt('LLM_BASE_URL')),
      xai: Boolean(opt('XAI_API_KEY')),
      composio: Boolean(opt('COMPOSIO_API_KEY')),
      orgo: Boolean(opt('ORGO_API_KEY')),
    };
  },
};
