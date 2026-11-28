import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { updateEnvFile } from './lib/envFile.js';

const desktopSignupOrigin = process.env.TIDEBOT_DESKTOP_SIGNUP_ORIGIN ?? '';
const desktopPort = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(desktopSignupOrigin)?.[1];
const envFilePath = process.env.ENV_PATH
  ? path.resolve(process.env.ENV_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
let lastFileSig = '';
let diskEnv: Record<string, string> = Object.create(null);

function clearRemovedKeys(next: Record<string, string>) {
  // A key deleted from .env (or when .env itself is removed) must stop working:
  // clear every key the file used to provide but no longer does — only when
  // process.env still holds the file's old value, so a value set externally
  // (Docker env, shell) is not clobbered by cleanup.
  for (const key of Object.keys(diskEnv)) {
    if (!Object.hasOwn(next, key) && process.env[key] === diskEnv[key]) {
      delete process.env[key];
    }
  }
}

export function reloadEnvFromDisk(): Record<string, string> {
  try {
    const st = fs.statSync(envFilePath);
    const sig = `${st.mtimeMs}:${st.ctimeMs}:${st.size}:${st.ino}`;
    if (sig !== lastFileSig) {
      const raw = fs.readFileSync(envFilePath, 'utf8');
      const parsed: Record<string, string> = Object.create(null);
      for (const [key, value] of Object.entries(parseEnv(raw))) {
        if (typeof value !== 'string') continue;
        parsed[key] = value;
        process.env[key] = value;
      }
      clearRemovedKeys(parsed);
      diskEnv = parsed;
      lastFileSig = sig;
    }
  } catch (err: any) {
    // If .env was deleted after previously being loaded, revoke every key it provided.
    if (err?.code === 'ENOENT' && lastFileSig !== '') {
      const empty: Record<string, string> = Object.create(null);
      clearRemovedKeys(empty);
      diskEnv = empty;
      lastFileSig = '';
    }
  }
  return diskEnv;
}

// Initial load on startup
reloadEnvFromDisk();

export function writeEnvKeyToDisk(key: string, value: string) {
  // Atomic rewrite (temp file + rename); validation and write errors propagate
  // so callers report failures instead of silently keeping a stale value.
  updateEnvFile(envFilePath, key, value);
  lastFileSig = '';
  reloadEnvFromDisk();
}

function opt(name: string, fallback = ''): string {
  reloadEnvFromDisk();
  const v = (diskEnv[name] ?? process.env[name])?.trim();
  return v || fallback;
}

function posInt(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = opt(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= max ? n : fallback;
}

const sessionSecretInit = opt('SESSION_SECRET', crypto.randomBytes(32).toString('hex'));

export const env = {
  desktopSignupOrigin: desktopPort ? desktopSignupOrigin : '',
  get port() { return desktopPort ? Number(desktopPort) : posInt('PORT', 8787, 65535); },
  get host() { return desktopPort ? '127.0.0.1' : opt('HOST', '127.0.0.1'); },
  /** Local sign-in identity from .env (STUDIO_EMAIL / STUDIO_PASSWORD). Empty disables password sign-in. */
  get studioEmail() { return opt('STUDIO_EMAIL').toLowerCase(); },
  get studioAdminEmail() { return opt('STUDIO_ADMIN_EMAIL', env.studioEmail).toLowerCase(); },
  get studioPassword() { return opt('STUDIO_PASSWORD'); },
  get appUrl() { return desktopPort ? desktopSignupOrigin : opt('APP_URL', 'http://localhost:5173'); },
  /** Public URL of this server, used for OAuth callbacks. */
  get serverUrl() { return desktopPort ? desktopSignupOrigin : opt('SERVER_URL', `http://localhost:${posInt('PORT', 8787, 65535)}`); },
  get llmProvider(): 'openrouter' | 'custom' | 'xai' {
    const orKey = opt('OPENROUTER_API_KEY');
    const cUrl = opt('LLM_BASE_URL');
    const xKey = opt('XAI_API_KEY');
    const explicit = opt('LLM_PROVIDER').toLowerCase();
    if (explicit === 'openrouter' || explicit === 'custom' || explicit === 'xai') return explicit;
    return orKey ? 'openrouter' : cUrl ? 'custom' : xKey ? 'xai' : 'openrouter';
  },
  get openrouterKey() { return opt('OPENROUTER_API_KEY'); },
  get openrouterModel() { return opt('OPENROUTER_MODEL', 'openrouter/free'); },
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
  get orgoRamGb() { return posInt('ORGO_RAM_GB', 8); },
  get orgoCpu() { return posInt('ORGO_CPU', 2); },
  get orgoResolution() { return opt('ORGO_RESOLUTION', '1280x800x24'); },
  sessionSecret: sessionSecretInit,
  get devLogin() { return opt('DEV_LOGIN') === '1'; },
  dbPath: process.env.DB_PATH ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/grokbot.db'),
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
