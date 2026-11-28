import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, nextRunLabel, shortDate } from '../web/src/lib/uiFormat.ts';

function normalizeSpaces(s) {
  return s.replace(/[\u00a0\u202f]/g, ' ');
}

test('shortDate returns empty string for non-finite or out-of-range timestamps', () => {
  assert.equal(shortDate(Number.NaN), '');
  assert.equal(shortDate(Number.POSITIVE_INFINITY), '');
  assert.equal(shortDate(Number.NEGATIVE_INFINITY), '');
  assert.equal(shortDate(1e20), '');
  assert.equal(shortDate(-1e20), '');
});

test('shortDate omits year for current year and includes year for other years', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
  const sameYear = new Date(2026, 2, 9, 12, 0, 0).getTime();
  const prevYear = new Date(2025, 11, 31, 12, 0, 0).getTime();

  assert.equal(shortDate(sameYear, now), 'Mar 9');
  assert.equal(shortDate(prevYear, now), 'Dec 31, 2025');
});

test('nextRunLabel returns empty string for null, zero, non-finite, or out-of-range timestamps', () => {
  assert.equal(nextRunLabel(null), '');
  assert.equal(nextRunLabel(undefined), '');
  assert.equal(nextRunLabel(0), '');
  assert.equal(nextRunLabel(Number.NaN), '');
  assert.equal(nextRunLabel(Number.POSITIVE_INFINITY), '');
  assert.equal(nextRunLabel(Number.NEGATIVE_INFINITY), '');
  assert.equal(nextRunLabel(1e20), '');
});

test('nextRunLabel formats today, tomorrow, and later weekdays in the routine time zone', () => {
  // 2026-06-10T02:00:00Z is Jun 9 10:00 PM in America/New_York and Jun 10 11:00 AM in Asia/Tokyo.
  const now = Date.parse('2026-06-10T02:00:00Z');
  // 2026-06-10T12:00:00Z is Jun 10 8:00 AM in America/New_York and Jun 10 9:00 PM in Asia/Tokyo.
  const target = Date.parse('2026-06-10T12:00:00Z');

  assert.equal(normalizeSpaces(nextRunLabel(target, 'America/New_York', now)), 'Next tomorrow 8:00 AM');
  assert.equal(normalizeSpaces(nextRunLabel(target, 'Asia/Tokyo', now)), 'Next today 9:00 PM');

  // 3 days later in America/New_York (Fri Jun 12)
  const later = Date.parse('2026-06-12T13:30:00Z');
  assert.equal(normalizeSpaces(nextRunLabel(later, 'America/New_York', now)), 'Next Fri 9:30 AM');
});

test('nextRunLabel handles DST spring-forward and fall-back transitions without mislabeling tomorrow', () => {
  // Fall-back day (25-hour day in America/New_York): Sun Nov 1, 2026 00:30 EDT.
  // Adding 86_400_000 ms stays on Sun Nov 1 (23:30 EST), so naive +24h mislabels Mon Nov 2.
  const fallBackNow = Date.parse('2026-11-01T04:30:00Z');
  const fallBackTomorrow = Date.parse('2026-11-02T13:00:00Z'); // Mon Nov 2 8:00 AM EST
  assert.equal(
    normalizeSpaces(nextRunLabel(fallBackTomorrow, 'America/New_York', fallBackNow)),
    'Next tomorrow 8:00 AM',
  );

  // Eve of spring-forward (23-hour day ahead in America/New_York): Sat Mar 7, 2026 23:30 EST.
  // Adding 86_400_000 ms jumps straight to Mon Mar 9 00:30 EDT, skipping Sun Mar 8!
  const springEveNow = Date.parse('2026-03-08T04:30:00Z'); // Sat Mar 7 11:30 PM EST
  const springTomorrow = Date.parse('2026-03-08T12:00:00Z'); // Sun Mar 8 8:00 AM EDT
  const springTwoDays = Date.parse('2026-03-09T12:00:00Z'); // Mon Mar 9 8:00 AM EDT
  assert.equal(
    normalizeSpaces(nextRunLabel(springTomorrow, 'America/New_York', springEveNow)),
    'Next tomorrow 8:00 AM',
  );
  assert.equal(
    normalizeSpaces(nextRunLabel(springTwoDays, 'America/New_York', springEveNow)),
    'Next Mon 8:00 AM',
  );
});

test('nextRunLabel handles year rollover and falls back cleanly on invalid or blank time zones', () => {
  const newYearsEve = Date.parse('2026-12-31T23:00:00Z');
  const newYearsDay = Date.parse('2027-01-01T08:00:00Z');
  assert.equal(
    normalizeSpaces(nextRunLabel(newYearsDay, 'UTC', newYearsEve)),
    'Next tomorrow 8:00 AM',
  );

  // Invalid and whitespace-only time zones must not throw.
  const labelInvalid = nextRunLabel(newYearsDay, 'Mars/Olympus', newYearsEve);
  const labelBlank = nextRunLabel(newYearsDay, '   ', newYearsEve);
  assert.ok(labelInvalid.startsWith('Next '));
  assert.equal(labelInvalid, labelBlank);
});

test('formatBytes guards invalid/negative inputs and formats B, KB, MB, and GB', () => {
  assert.equal(formatBytes(Number.NaN), '0 B');
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), '0 B');
  assert.equal(formatBytes(Number.NEGATIVE_INFINITY), '0 B');
  assert.equal(formatBytes(-42), '0 B');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1023.6), '1.0 KB');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(10 * 1024), '10 KB');
  assert.equal(formatBytes(512 * 1024), '512 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), '1.5 GB');
});
