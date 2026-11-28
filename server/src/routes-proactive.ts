import { Hono } from 'hono';
import { requireUser, type AuthVars } from './lib/auth.js';
import { fireCheckin, getCheckins, setCheckins } from './proactive.js';

/** /api/checkins: proactive check-in settings for the primary bot. */
export const checkinsApi = new Hono<AuthVars>();
checkinsApi.use('*', requireUser);

checkinsApi.get('/', (c) => c.json(getCheckins(c.get('user').id)));

checkinsApi.put('/', async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  try {
    return c.json(setCheckins(c.get('user').id, body as { enabled?: unknown; times?: unknown; timezone?: unknown }));
  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 400);
  }
});

/** Trigger a check-in now (for testing / "check in with me" button). */
checkinsApi.post('/now', (c) => {
  const result = fireCheckin(c.get('user').id, 0, true);
  if (result === 'disabled') return c.json({ error: 'Check-in scheduler is disabled.' }, 503);
  if (result === 'no_primary') return c.json({ error: 'No primary Operator found.' }, 404);
  return c.json({ ok: true });
});
