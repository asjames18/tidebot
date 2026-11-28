export type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing';

export interface DictationKeyLike {
  key: string;
  repeat?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Joins finalized speech recognition chunks without fusing adjacent words
 * (e.g. `"Hello world"` + `"How are you"` -> `"Hello world How are you"`),
 * while avoiding stray spaces before closing punctuation.
 */
export function appendTranscriptChunk(accumulated: string, chunk: string): string {
  if (!chunk || !chunk.trim()) return accumulated;
  if (!accumulated) return chunk.trimStart();
  if (/\s$/.test(accumulated) || /^\s/.test(chunk) || /^[,.;:!?)\]}]/.test(chunk)) {
    return accumulated + chunk;
  }
  return `${accumulated} ${chunk}`;
}

export function speechRecognitionErrorMessage(code: string | undefined): string | null {
  if (code === 'aborted') return null;
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone access was denied.';
  if (code === 'no-speech') return 'No speech detected — try again.';
  if (code === 'audio-capture') return 'No microphone found.';
  return 'Dictation failed — try again.';
}

export function shouldCancelDictationOnKey(e: DictationKeyLike): boolean {
  if (e.key !== 'Escape') return false;
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  return true;
}

export function shouldToggleDictationOnKey(e: DictationKeyLike): boolean {
  if (e.key !== 'Enter' && e.key !== ' ') return false;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return false;
  return true;
}

/**
 * Coordinates dictation lifecycle phases (`idle -> starting -> recording -> transcribing`)
 * so cancelling or unmounting during mic permission acquisition or transcription
 * invalidates stale callbacks and tells callers to release acquired mic tracks.
 */
export class DictationSessionGate {
  private gen = 0;
  private phase: DictationPhase = 'idle';

  get currentPhase(): DictationPhase {
    return this.phase;
  }

  beginStart(): number | null {
    if (this.phase !== 'idle') return null;
    this.gen += 1;
    this.phase = 'starting';
    return this.gen;
  }

  activateRecording(gen: number): boolean {
    if (this.gen !== gen || this.phase !== 'starting') return false;
    this.phase = 'recording';
    return true;
  }

  beginTranscribing(gen: number): boolean {
    if (this.gen !== gen || this.phase !== 'recording') return false;
    this.phase = 'transcribing';
    return true;
  }

  isCurrent(gen: number): boolean {
    return this.gen === gen && this.phase !== 'idle';
  }

  finish(gen: number): boolean {
    if (this.gen !== gen) return false;
    this.phase = 'idle';
    return true;
  }

  cancel(): void {
    this.gen += 1;
    this.phase = 'idle';
  }
}
