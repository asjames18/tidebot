const MS_PER_DAY = 86_400_000;
const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function safeNowDate(nowMs: number): Date {
  if (Number.isFinite(nowMs)) {
    const d = new Date(nowMs);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function resolveTimeZone(timeZone?: string): string | undefined {
  const trimmed = timeZone?.trim();
  if (!trimmed) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return trimmed;
  } catch {
    return undefined;
  }
}

/** Civil calendar day number (days since 1970-01-01) in the given IANA time zone. */
function civilDayNumber(date: Date, timeZone?: string): number | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  let year = Number.NaN;
  let month = Number.NaN;
  let day = Number.NaN;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return Math.floor(utc.getTime() / MS_PER_DAY);
}

export function shortDate(ts: number, nowMs = Date.now()): string {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = safeNowDate(nowMs);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/** "Next today 8:00 AM", shown in the routine's own time zone so it matches its schedule text. */
export function nextRunLabel(ts: number | null | undefined, timeZone?: string, nowMs = Date.now()): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const target = new Date(ts);
  if (Number.isNaN(target.getTime())) return '';
  const tz = resolveTimeZone(timeZone);
  const now = safeNowDate(nowMs);
  const targetDay = civilDayNumber(target, tz);
  const nowDay = civilDayNumber(now, tz);
  const day = target.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
  const time = target.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const diffDays = targetDay !== null && nowDay !== null ? targetDay - nowDay : null;
  const rel = diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : day;
  return `Next ${rel} ${time}`;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const bytes = Math.round(n);
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(bytes < 10 * KB ? 1 : 0)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}
