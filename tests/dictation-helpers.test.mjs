import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTranscriptChunk,
  DictationSessionGate,
  shouldCancelDictationOnKey,
  shouldToggleDictationOnKey,
  speechRecognitionErrorMessage,
} from '../web/src/lib/dictationHelpers.ts';

test('appendTranscriptChunk inserts spacing between continuous speech segments without breaking punctuation', () => {
  assert.equal(appendTranscriptChunk('', '  Hello world'), 'Hello world');
  assert.equal(appendTranscriptChunk('Hello world', 'How are you'), 'Hello world How are you');
  assert.equal(appendTranscriptChunk('Hello world ', 'How are you'), 'Hello world How are you');
  assert.equal(appendTranscriptChunk('Hello world', ' How are you'), 'Hello world How are you');
  assert.equal(appendTranscriptChunk('Hello world', ', friend!'), 'Hello world, friend!');
  assert.equal(appendTranscriptChunk('Hello world', '   '), 'Hello world');
});

test('speechRecognitionErrorMessage suppresses aborted and maps mic errors', () => {
  assert.equal(speechRecognitionErrorMessage('aborted'), null);
  assert.equal(speechRecognitionErrorMessage('not-allowed'), 'Microphone access was denied.');
  assert.equal(speechRecognitionErrorMessage('service-not-allowed'), 'Microphone access was denied.');
  assert.equal(speechRecognitionErrorMessage('no-speech'), 'No speech detected — try again.');
  assert.equal(speechRecognitionErrorMessage('audio-capture'), 'No microphone found.');
  assert.equal(speechRecognitionErrorMessage('network'), 'Dictation failed — try again.');
});

test('dictation keyboard guards reject IME Escape, defaultPrevented, modifiers, and key repeat', () => {
  assert.equal(shouldCancelDictationOnKey({ key: 'Escape' }), true);
  assert.equal(shouldCancelDictationOnKey({ key: 'Escape', defaultPrevented: true }), false);
  assert.equal(shouldCancelDictationOnKey({ key: 'Escape', isComposing: true }), false);
  assert.equal(shouldCancelDictationOnKey({ key: 'Escape', keyCode: 229 }), false);
  assert.equal(shouldCancelDictationOnKey({ key: 'Escape', ctrlKey: true }), false);

  assert.equal(shouldToggleDictationOnKey({ key: 'Enter' }), true);
  assert.equal(shouldToggleDictationOnKey({ key: ' ' }), true);
  assert.equal(shouldToggleDictationOnKey({ key: ' ', repeat: true }), false);
  assert.equal(shouldToggleDictationOnKey({ key: 'Enter', metaKey: true }), false);
});

test('DictationSessionGate rejects overlapping starts and invalidates cancelled mic/transcription sessions', () => {
  const gate = new DictationSessionGate();
  const g1 = gate.beginStart();
  assert.ok(g1 !== null);
  assert.equal(gate.currentPhase, 'starting');
  // Cannot start a second overlapping session while starting.
  assert.equal(gate.beginStart(), null);

  // Cancel while openMic() is still pending -> activateRecording returns false so caller stops mic tracks.
  gate.cancel();
  assert.equal(gate.currentPhase, 'idle');
  assert.equal(gate.activateRecording(g1), false);

  // Full normal lifecycle: starting -> recording -> transcribing -> cancelled before transcribe resolves.
  const g2 = gate.beginStart();
  assert.ok(g2 !== null);
  assert.equal(gate.activateRecording(g2), true);
  assert.equal(gate.beginTranscribing(g2), true);
  assert.equal(gate.beginStart(), null); // blocked during transcribing
  assert.equal(gate.isCurrent(g2), true);

  gate.cancel();
  assert.equal(gate.isCurrent(g2), false);
  assert.equal(gate.finish(g2), false);
});
