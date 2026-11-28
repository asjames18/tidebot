#!/usr/bin/env node
// npm run doctor — one-line health check against a running TideBot server.
// Prints Node version, database readability/writability, sandbox status and
// which provider keys are configured (yes/no flags only — keys are never
// printed). Exits non-zero when the server is unreachable or unhealthy.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

function configuredPort() {
  const file = process.env.ENV_PATH || new URL('../.env', import.meta.url);
  try {
    const port = Number(parseEnv(readFileSync(file, 'utf8')).PORT);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('doctor: could not read the server environment file');
      process.exit(1);
    }
  }
  return 8787;
}

const port = process.env.PORT === undefined ? configuredPort() : Number(process.env.PORT);
const base = `http://127.0.0.1:${port}`;
const healthUrl = `${base}/api/health?detail=1`;
const signal = AbortSignal.timeout(5_000);
let res;
let d;
try {
  res = await fetch(healthUrl, { signal, redirect: 'manual' });
  if (res.ok) d = await res.json();
} catch {
  if (signal.aborted) {
    console.error(`doctor: health check timed out at ${healthUrl}`);
  } else if (res) {
    console.error(`doctor: invalid health response from ${healthUrl}`);
  } else {
    console.error(`doctor: server not reachable at ${base} — is it running? (npm run dev -w server / npm start)`);
  }
  process.exit(1);
}
if (!res.ok) {
  console.error(`doctor: /api/health?detail=1 returned HTTP ${res.status}`);
  process.exit(1);
}
if (typeof d?.ok !== 'boolean' || !d.database) {
  console.error(`doctor: invalid health response from ${healthUrl}`);
  process.exit(1);
}
const db = d.database ?? {};
const sb = d.sandbox?.bubblewrap ?? {};
const providers = d.providers ?? {};
const configured = Object.entries(providers).filter(([, v]) => v).map(([k]) => k);
console.log(`node: ${d.node ?? 'unknown'}`);
console.log(`database: ${db.path ?? 'unknown'} — ${db.exists ? 'exists' : 'not created yet'}, readable=${db.readable === true}, writable=${db.writable === true}`);
console.log(`sandbox: bubblewrap ${sb.installed ? `installed (${sb.path})` : 'not installed — local shell commands will be refused'}`);
console.log(`providers configured: ${configured.length ? configured.join(', ') : 'none'}`);
if (d.ok !== true || db.readable !== true || db.writable !== true) {
  console.error('doctor: unhealthy — see lines above');
  process.exit(1);
}
