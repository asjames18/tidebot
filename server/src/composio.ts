import { Composio } from '@composio/core';
import { OpenAIResponsesProvider } from '@composio/openai';
import { db } from './db.js';
import { env } from './env.js';
import type { Toolkit } from './types.js';

let activeKey = '';
let clientInstance: Composio<OpenAIResponsesProvider> | null = null;
const sessionCache = new Map<string, any>();

type CatalogItem = Omit<Toolkit, 'connected'>;
let catalogCache: { at: number; key: string; items: CatalogItem[] } | null = null;

export function getComposio(): Composio<OpenAIResponsesProvider> {
  const key = env.composioKey || 'local-unconfigured-key';
  if (!clientInstance || activeKey !== key) {
    activeKey = key;
    clientInstance = new Composio({ apiKey: key, provider: new OpenAIResponsesProvider() });
    sessionCache.clear();
    catalogCache = null;
  }
  return clientInstance!;
}

export const composio = new Proxy({} as Composio<OpenAIResponsesProvider>, {
  get(_target, prop, receiver) {
    const inst = getComposio() as any;
    const val = Reflect.get(inst, prop, receiver);
    return typeof val === 'function' ? val.bind(inst) : val;
  },
});

const REST = 'https://backend.composio.dev/api/v3.1';
async function rest<T = any>(path: string): Promise<T> {
  const key = env.composioKey;
  if (!key) throw new Error('COMPOSIO_API_KEY is not configured in .env');
  const res = await fetch(`${REST}${path}`, { headers: { 'x-api-key': key } });
  if (!res.ok) throw new Error(`Composio ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ---------- catalog (user-independent, cached) ----------

const FALLBACK_CATALOG: CatalogItem[] = [
  { slug: 'gmail', name: 'Gmail', description: 'Read, search, draft, and send emails in Gmail.', categories: ['Communication', 'Productivity'], managedAuth: true, noAuth: false },
  { slug: 'googlecalendar', name: 'Google Calendar', description: 'Check availability, schedule meetings, and manage events.', categories: ['Productivity', 'Calendar'], managedAuth: true, noAuth: false },
  { slug: 'slack', name: 'Slack', description: 'Send messages, monitor channels, and collaborate in Slack workspaces.', categories: ['Communication', 'Team'], managedAuth: true, noAuth: false },
  { slug: 'github', name: 'GitHub', description: 'Manage repositories, issues, pull requests, and code workflows.', categories: ['Developer Tools'], managedAuth: true, noAuth: false },
  { slug: 'notion', name: 'Notion', description: 'Search, create, and update pages and databases in Notion.', categories: ['Productivity', 'Docs'], managedAuth: true, noAuth: false },
  { slug: 'linear', name: 'Linear', description: 'Create issues, triage bugs, and track engineering cycles in Linear.', categories: ['Developer Tools', 'Project Management'], managedAuth: true, noAuth: false },
  { slug: 'googledrive', name: 'Google Drive', description: 'Search, organize, and manage files and folders in Google Drive.', categories: ['Storage', 'Productivity'], managedAuth: true, noAuth: false },
  { slug: 'googledocs', name: 'Google Docs', description: 'Create and edit documents in Google Docs.', categories: ['Docs', 'Productivity'], managedAuth: true, noAuth: false },
  { slug: 'googlesheets', name: 'Google Sheets', description: 'Read and write spreadsheet rows and formulas in Google Sheets.', categories: ['Productivity', 'Data'], managedAuth: true, noAuth: false },
  { slug: 'twitter', name: 'X (Twitter)', description: 'Post updates, search timelines, and monitor mentions on X.', categories: ['Social', 'Marketing'], managedAuth: true, noAuth: false },
  { slug: 'discord', name: 'Discord', description: 'Send messages and manage community channels on Discord.', categories: ['Communication', 'Social'], managedAuth: true, noAuth: false },
  { slug: 'figma', name: 'Figma', description: 'Inspect design files, comments, and components in Figma.', categories: ['Design'], managedAuth: true, noAuth: false },
  { slug: 'jira', name: 'Jira', description: 'Track issues, sprints, and project workflows in Atlassian Jira.', categories: ['Project Management', 'Developer Tools'], managedAuth: true, noAuth: false },
  { slug: 'airtable', name: 'Airtable', description: 'Query and update records across Airtable bases and tables.', categories: ['Data', 'Productivity'], managedAuth: true, noAuth: false },
];

export async function catalog(): Promise<CatalogItem[]> {
  const key = env.composioKey;
  if (!key) return FALLBACK_CATALOG;
  if (catalogCache && catalogCache.key === key && Date.now() - catalogCache.at < 3600_000) return catalogCache.items;
  try {
    const items: CatalogItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const r = await rest<any>(`/toolkits?sort_by=usage&limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      for (const t of r.items ?? []) {
        items.push({
          slug: t.slug,
          name: t.name,
          logo: t.meta?.logo,
          description: t.meta?.description,
          categories: (t.meta?.categories ?? []).map((c: any) => String(c.name ?? c.id ?? '').toLowerCase()).filter(Boolean),
          managedAuth: (t.composio_managed_auth_schemes ?? []).length > 0,
          noAuth: !!t.no_auth,
        });
      }
      cursor = r.next_cursor;
      if (!cursor) break;
    }
    if (!items.length) return FALLBACK_CATALOG;
    catalogCache = { at: Date.now(), key, items };
    return items;
  } catch (e) {
    console.warn('[composio] catalog fetch failed, using fallback catalog:', (e as Error).message);
    return FALLBACK_CATALOG;
  }
}

export async function toolkitInfo(slug: string): Promise<CatalogItem | undefined> {
  return (await catalog()).find((t) => t.slug === slug);
}

// ---------- per-user connections ----------

export async function connectedToolkits(userId: string): Promise<Set<string>> {
  if (!env.composioKey) return new Set();
  const r = await getComposio().connectedAccounts.list({ userIds: [userId], statuses: ['ACTIVE'] } as any);
  const items: any[] = (r as any).items ?? [];
  return new Set(items.map((i) => i.toolkit?.slug ?? i.toolkitSlug).filter(Boolean));
}

export async function connectionsDetail(userId: string) {
  if (!env.composioKey) return [];
  const r = await getComposio().connectedAccounts.list({ userIds: [userId] } as any);
  return ((r as any).items ?? []).map((i: any) => ({ id: i.id, toolkit: i.toolkit?.slug ?? i.toolkitSlug, status: i.status }));
}

export async function disconnect(userId: string, toolkit: string) {
  for (const c of await connectionsDetail(userId)) {
    if (c.toolkit === toolkit) await getComposio().connectedAccounts.delete(c.id);
  }
  sessionCache.delete(userId);
}

// ---------- sessions (tool router) ----------

export async function sessionFor(userId: string): Promise<any> {
  if (!env.composioKey) throw new Error('COMPOSIO_API_KEY is not configured in .env');
  const client = getComposio();
  const cached = sessionCache.get(userId);
  if (cached) return cached;
  const row = db.prepare('SELECT session_id FROM composio_sessions WHERE user_id=?').get(userId) as any;
  let session: any;
  if (row) {
    try { session = await client.use(row.session_id); } catch { session = null; }
  }
  if (!session) {
    session = await client.create(userId, { manageConnections: false } as any);
    db.prepare('INSERT OR REPLACE INTO composio_sessions(user_id, session_id) VALUES (?,?)').run(userId, session.sessionId);
  }
  sessionCache.set(userId, session);
  return session;
}

/** Start a connect flow; returns the hosted Connect Link URL. */
export async function startConnect(userId: string, toolkit: string, callbackUrl: string): Promise<{ redirectUrl: string; connectedAccountId?: string }> {
  const session = await sessionFor(userId);
  const req = await session.authorize(toolkit, { callbackUrl });
  return { redirectUrl: req.redirectUrl, connectedAccountId: req.id };
}

/** OpenAI-Responses-format function tools for this user's Composio session (meta tools). */
export async function composioTools(userId: string): Promise<any[]> {
  if (!env.composioKey) return [];
  try {
    const session = await sessionFor(userId);
    const tools = await session.tools();
    return Array.isArray(tools) ? tools : [];
  } catch (e) {
    console.warn('[composio] tools unavailable', (e as Error).message);
    return [];
  }
}

export async function executeComposio(userId: string, name: string, args: Record<string, unknown>) {
  const session = await sessionFor(userId);
  const r = await session.execute(name, args);
  return r as { data?: unknown; error?: unknown; resultType?: string; logId?: string };
}

/** Which inner tool slugs a Composio meta-tool call would run (for approval checks). */
export function innerToolSlugs(name: string, args: any): string[] {
  if (name === 'COMPOSIO_MULTI_EXECUTE_TOOL') {
    const list = args?.tools ?? args?.tool_calls ?? args?.actions ?? [];
    return (Array.isArray(list) ? list : []).map((t: any) => String(t.tool_slug ?? t.slug ?? t.name ?? t.tool ?? '')).filter(Boolean);
  }
  if (name.startsWith('COMPOSIO_')) return [];
  return [name];
}

const READ_RE = /_(GET|LIST|SEARCH|FETCH|FIND|READ|RETRIEVE|QUERY|LOOKUP|CHECK|DESCRIBE|VIEW|COUNT)(_|$)/;
export const isReadOnlySlug = (slug: string) => READ_RE.test(slug.toUpperCase());

// ---------- sign-in via Composio-managed Google (Gmail) connection ----------

export async function startGoogleLogin(provisionalUserId: string, callbackUrl: string) {
  const session = await getComposio().create(provisionalUserId, { manageConnections: false } as any);
  const req = await (session as any).authorize('gmail', { callbackUrl });
  return { redirectUrl: req.redirectUrl as string, connectedAccountId: req.id as string | undefined };
}

export async function googleProfile(connectedAccountId: string): Promise<{ email: string; name?: string }> {
  const r: any = await getComposio().tools.proxyExecute({
    endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    method: 'GET',
    connectedAccountId,
  } as any);
  const data = r?.data ?? r;
  const email = data?.emailAddress ?? data?.email;
  if (!email) throw new Error(`Could not read Google profile: ${JSON.stringify(r).slice(0, 300)}`);
  return { email, name: undefined };
}

export async function deleteConnection(id: string) {
  try { await getComposio().connectedAccounts.delete(id); } catch { /* ignore */ }
}
