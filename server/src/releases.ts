// In-app release notices for self-hosters (RAK-41).
//
// The server checks the public GitHub Releases API for the newest published
// release — including dev-channel prereleases, which are TideBot's primary
// distribution — and the UI shows a dismissible "what's new" notice when the
// running install is behind. No secrets, no third-party service: the endpoint
// is anonymous public API data, cached in memory with stale-on-error fallback
// so a failed or rate-limited check never breaks the app.

export const APP_VERSION = '1.0.0';

const REPO = 'asjames18/tidebot';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=1`;
const TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export interface ReleaseInfo {
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
  notes: string;
}

export interface ReleaseStatus {
  release: ReleaseInfo | null;
  current: string;
  updateAvailable: boolean;
}

export function parseVersion(v: string): { major: number; minor: number; patch: number; pre: (string | number)[] | null } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : null,
  };
}

function comparePre(a: (string | number)[], b: (string | number)[]): number {
  // Semver rule 11: numeric identifiers compare numerically and always rank
  // below alphanumeric ones; a shorter list of equal prefix ranks lower.
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
    } else if (typeof x === 'string' && typeof y === 'string') {
      if (x !== y) return x < y ? -1 : 1;
    } else {
      // number vs string: number is lower
      return typeof x === 'number' ? -1 : 1;
    }
  }
  return 0;
}

// TideBot ships dev-channel prereleases (`<base>-dev.<run number>`) as its
// primary distribution, so plain semver precedence would hide them from a
// bare-version install (1.0.0-dev.8 ranks below 1.0.0). Notices therefore use
// release-channel ordering:
//   - greater base version (major.minor.patch) always wins;
//   - equal base: a prerelease with a greater prerelease list is newer;
//   - equal base: a prerelease counts as newer than a bare version (the dev
//     channel is ahead of the last tag), and a bare version beats a
//     prerelease of the same base (stable release of that tag).
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const ab = `${a.major}.${a.minor}.${a.patch}`;
  const bb = `${b.major}.${b.minor}.${b.patch}`;
  if (ab !== bb) return ab > bb;
  if (a.pre && b.pre) return comparePre(a.pre, b.pre) > 0;
  if (a.pre && !b.pre) return true;
  if (!a.pre && b.pre) return true;
  return false;
}

let cache: { at: number; release: ReleaseInfo | null } | null = null;
let inFlight: Promise<ReleaseInfo | null> | null = null;

export function resetReleaseCacheForTest(): void {
  cache = null;
  inFlight = null;
}

async function fetchLatest(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `tidebot/${APP_VERSION}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    const r = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    if (!r || typeof r.tag_name !== 'string') return null;
    return {
      tag: r.tag_name,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : r.tag_name,
      url: typeof r.html_url === 'string' ? r.html_url : `https://github.com/${REPO}/releases`,
      publishedAt: typeof r.published_at === 'string' ? r.published_at : null,
      notes: typeof r.body === 'string' ? r.body.slice(0, 2000) : '',
    };
  } catch {
    return null;
  }
}

export async function latestRelease(): Promise<ReleaseInfo | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.release;
  if (!inFlight) {
    inFlight = fetchLatest().finally(() => { inFlight = null; });
  }
  const release = await inFlight;
  if (release) cache = { at: Date.now(), release };
  return release ?? cache?.release ?? null; // stale-on-error
}

export async function releaseStatus(): Promise<ReleaseStatus> {
  const release = await latestRelease();
  return { release, current: APP_VERSION, updateAvailable: release ? isNewerVersion(release.tag, APP_VERSION) : false };
}
