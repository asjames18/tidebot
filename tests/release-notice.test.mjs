// Regression tests for RAK-41: in-app release notices.
// Pure version-ordering and status logic — never touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { APP_VERSION, parseVersion, isNewerVersion, releaseStatus } = await import('../server/dist/releases.js');

test('parseVersion accepts v-prefix, bare and prerelease forms, rejects junk', () => {
  assert.deepEqual(parseVersion('v1.0.0-dev.8'), { major: 1, minor: 0, patch: 0, pre: ['dev', 8] });
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: null });
  assert.equal(parseVersion('not-a-version'), null);
  assert.equal(parseVersion(''), null);
});

test('same base: higher dev run number is newer', () => {
  assert.equal(isNewerVersion('v1.0.0-dev.9', 'v1.0.0-dev.8'), true);
  assert.equal(isNewerVersion('v1.0.0-dev.8', 'v1.0.0-dev.9'), false);
  assert.equal(isNewerVersion('v1.0.0-dev.8', 'v1.0.0-dev.8'), false);
});

test('dev-channel prerelease counts as newer than the bare tag of the same base', () => {
  // A source install running plain 1.0.0 must be told about v1.0.0-dev.8 —
  // plain semver would rank the prerelease lower and hide every dev update.
  assert.equal(isNewerVersion('v1.0.0-dev.8', '1.0.0'), true);
  assert.equal(isNewerVersion('v1.0.1-dev.1', '1.0.0'), true);
});

test('stable releases rank above dev prereleases and older bases', () => {
  assert.equal(isNewerVersion('v1.0.0', 'v1.0.0-dev.8'), true);
  assert.equal(isNewerVersion('v1.1.0', 'v1.0.0-dev.8'), true);
  assert.equal(isNewerVersion('v0.9.0', 'v1.0.0-dev.8'), false);
  assert.equal(isNewerVersion('v1.0.0', 'v1.0.0'), false);
});

test('malformed versions never claim an update', () => {
  assert.equal(isNewerVersion('garbage', APP_VERSION), false);
  assert.equal(isNewerVersion('v1.0.0-dev.8', 'garbage'), false);
});

test('packaged desktop version suppresses a notice for the installed release', async (t) => {
  const previous = process.env.TIDEBOT_DESKTOP_VERSION;
  t.after(() => {
    if (previous === undefined) delete process.env.TIDEBOT_DESKTOP_VERSION;
    else process.env.TIDEBOT_DESKTOP_VERSION = previous;
  });
  process.env.TIDEBOT_DESKTOP_VERSION = '1.0.0-dev.42';
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => [{ tag_name: 'v1.0.0-dev.42', name: 'Current release' }],
  }));
  const { releaseStatus: desktopReleaseStatus } = await import('../server/dist/releases.js?desktop');
  const status = await desktopReleaseStatus();
  assert.equal(status.current, '1.0.0-dev.42');
  assert.equal(status.release?.tag, 'v1.0.0-dev.42');
  assert.equal(status.updateAvailable, false);
});

test('releaseStatus flags update only when the fetched release is newer', async (t) => {
  const { resetReleaseCacheForTest } = await import('../server/dist/releases.js');
  const realFetch = globalThis.fetch;
  const rel = (tag) => ({ tag_name: tag, name: tag, html_url: 'https://example.com/r', published_at: null, body: '' });
  const stub = (body) => t.mock.fn(async () => ({ ok: true, json: async () => [body] }));

  // Newer dev release than the running install -> update available.
  globalThis.fetch = stub(rel('v1.0.0-dev.9'));
  resetReleaseCacheForTest();
  let status = await releaseStatus();
  assert.equal(status.current, APP_VERSION);
  assert.equal(status.release?.tag, 'v1.0.0-dev.9');
  assert.equal(status.updateAvailable, true);

  // Same bare tag as the running install -> silent (no notice). Any dev
  // prerelease outranks a bare install, so use the identical version.
  globalThis.fetch = stub(rel('v1.0.0'));
  resetReleaseCacheForTest();
  status = await releaseStatus();
  assert.equal(status.updateAvailable, false);

  // Failed fetch -> stale-safe null, never a false notice.
  globalThis.fetch = async () => { throw new Error('down'); };
  resetReleaseCacheForTest();
  status = await releaseStatus();
  assert.equal(status.release, null);
  assert.equal(status.updateAvailable, false);

  globalThis.fetch = realFetch;
  resetReleaseCacheForTest();
});
