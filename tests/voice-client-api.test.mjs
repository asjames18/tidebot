import test from 'node:test';
import assert from 'node:assert/strict';
import { audioExtensionForMime, resetVoiceOptionsCache, voiceApi } from '../web/src/voice/api.ts';

function withStubFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
    resetVoiceOptionsCache();
  });
}

test('audioExtensionForMime maps audio MIME types case-insensitively', () => {
  assert.equal(audioExtensionForMime('AUDIO/OGG;codecs=opus'), 'ogg');
  assert.equal(audioExtensionForMime('audio/MP4'), 'm4a');
  assert.equal(audioExtensionForMime('audio/x-m4a'), 'm4a');
  assert.equal(audioExtensionForMime('audio/wav'), 'wav');
  assert.equal(audioExtensionForMime('audio/mpeg'), 'mp3');
  assert.equal(audioExtensionForMime('audio/webm;codecs=opus'), 'webm');
  assert.equal(audioExtensionForMime(''), 'webm');
});

test('voiceApi.preview surfaces server JSON error and rejects HTML or empty 200 payloads', async (t) => {
  let mode = 'missing-key';
  withStubFetch(t, async () => {
    if (mode === 'missing-key') {
      return new Response(
        JSON.stringify({ error: 'Add an xAI key in studio model settings to use xAI voice.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (mode === 'html-200') {
      return new Response('<html>Sign in</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    if (mode === 'empty-200') {
      return new Response(new Uint8Array(0), { status: 200, headers: { 'Content-Type': 'audio/pcm;rate=24000' } });
    }
    const pcm = new Int16Array([1000, -1000, 500]);
    return new Response(pcm.buffer, { status: 200, headers: { 'Content-Type': 'audio/pcm;rate=24000' } });
  });

  await assert.rejects(
    voiceApi.preview({ botId: 'bot-1' }),
    /Add an xAI key in studio model settings/,
  );

  mode = 'html-200';
  await assert.rejects(voiceApi.preview({ botId: 'bot-1' }), /Preview unavailable/);

  mode = 'empty-200';
  await assert.rejects(voiceApi.preview({ botId: 'bot-1' }), /Preview unavailable/);

  mode = 'valid-pcm';
  const samples = await voiceApi.preview({ botId: 'bot-1' });
  assert.deepEqual([...samples], [1000, -1000, 500]);
});

test('voiceApi.transcribe omits auto/blank language, normalizes filename, and handles missing text/blank errors', async (t) => {
  const seen = [];
  let mode = 'ok';
  withStubFetch(t, async (_url, init) => {
    const fd = init.body;
    const file = fd.get('file');
    seen.push({ language: fd.get('language'), fileName: file?.name });
    if (mode === 'blank-error') {
      return new Response(JSON.stringify({ error: '   ' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    if (mode === 'missing-text') {
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ text: 'hello' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const mp4Blob = new Blob([new Uint8Array(256)], { type: 'AUDIO/MP4' });
  assert.equal(await voiceApi.transcribe(mp4Blob, 'auto'), 'hello');
  assert.deepEqual(seen[0], { language: null, fileName: 'dictation.m4a' });

  mode = 'missing-text';
  assert.equal(await voiceApi.transcribe(mp4Blob, '  es  '), '');
  assert.deepEqual(seen[1], { language: 'es', fileName: 'dictation.m4a' });

  mode = 'blank-error';
  await assert.rejects(voiceApi.transcribe(mp4Blob, 'en'), /Transcription failed/);
});

test('voiceApi.options rejects malformed payloads without caching the failure', async (t) => {
  let calls = 0;
  withStubFetch(t, async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ wrong: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(
      JSON.stringify({ voices: [{ id: 'ara', name: 'Ara' }], languages: [{ code: 'en', name: 'English' }], speeds: [1] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  resetVoiceOptionsCache();
  await assert.rejects(voiceApi.options(), /Invalid voice options/);
  const opts = await voiceApi.options();
  assert.equal(opts.voices[0].id, 'ara');
  assert.equal(calls, 2);
});
