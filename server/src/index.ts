import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { env } from './env.js';
import { api } from './routes.js';
import { attachVncRelay } from './vnc.js';
import { initRoutines } from './routines.js';
import { initTriggers } from './triggers.js';
import { initProactive } from './proactive.js';
import { initSubagents } from './agent/subagents.js';
import { initRooms } from './agent/rooms.js';
import { checkinsApi } from './routes-proactive.js';
import { roomsApi } from './routes-rooms.js';
import { enqueue } from './agent/loop.js';
import { desSelfTest } from './lib/des.js';
import { configApi } from './routes-config.js';
import { startIdleWatcher } from './idle.js';
import { startMemoryConsolidation } from './agent/memory.js';
import { rateLimit } from './lib/rateLimit.js';

if (!desSelfTest()) throw new Error('DES self-test failed');
initSubagents();
initRooms();

const app = new Hono();
const globalHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc: ["'self'", 'ws:', 'wss:'],
    workerSrc: ["'self'", 'blob:'],
    frameAncestors: ["'self'"],
  },
  xFrameOptions: 'SAMEORIGIN',
  referrerPolicy: 'same-origin',
});
// Preview pages carry their own sandbox CSP; the global policy would conflict with it.
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/preview/')) { await next(); return; }
  return globalHeaders(c, next);
});
// Compress responses (JS/CSS/HTML/JSON/SVG) while leaving SSE streams unbuffered.
const compressor = compress();
app.use('*', async (c, next) => {
  if (c.req.path === '/api/events') { await next(); return; }
  return compressor(c, next);
});
app.get('/api/health', (c) => c.json({ ok: true }));
app.use('/api/auth/*', rateLimit({ limit: 30, windowMs: 60_000 }));
app.use('/api/llm/*', rateLimit({ limit: 60, windowMs: 60_000 }));
app.use('/api/voice/*', rateLimit({ limit: 60, windowMs: 60_000 }));
app.route('/api/checkins', checkinsApi);
app.route('/api/rooms', roomsApi);
app.route('/api', api);
app.route('/api', configApi);

// Serve the built web app in production.
const webDist = path.resolve(new URL('.', import.meta.url).pathname, '../../web/dist');
if (fs.existsSync(webDist)) {
  const indexHtml = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
  app.use('/*', async (c, next) => {
    await next();
    if (c.req.path.startsWith('/api/')) return;
    if (/^\/assets\/[^/]+\.[a-z0-9]+$/i.test(c.req.path) && !c.req.path.startsWith('/assets/icons/')) {
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (c.req.path === '/' || c.req.path === '/index.html' || c.req.path === '/manifest.webmanifest') {
      c.header('Cache-Control', 'no-cache');
    } else if (c.res.status === 200) {
      c.header('Cache-Control', 'public, max-age=86400');
    }
  });
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), webDist) }));
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
}

const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => console.log(`[grokbot] server on http://${info.address}:${info.port} (model ${env.xaiModel})`));
attachVncRelay(server as unknown as Server);
// GROKBOT_NO_SCHEDULER=1 for extra dev/test servers sharing a database copy, so routines and triggers don't fire twice.
if (process.env.GROKBOT_NO_SCHEDULER !== '1') {
  initRoutines(enqueue);
  void initTriggers(enqueue);
initProactive(enqueue);
} else console.log('[grokbot] scheduler disabled (GROKBOT_NO_SCHEDULER=1)');
startIdleWatcher();
startMemoryConsolidation();
