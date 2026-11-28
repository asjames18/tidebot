import type { Project } from '@shared/types';

export type ProjectReference = Project['files'][number];

export const MAX_PROJECT_FILES = 6;
export const MAX_PROJECT_FILE_BYTES = 32_000;
export const MAX_PROJECT_FILE_CHARS = 8_000;

export interface IncomingReferenceFile {
  name: string;
  size: number;
  text(): Promise<string>;
}

const VALID_REF_NAME = /\.(md|txt|csv|json)$/i;
const UNSAFE_NAME_CHARS = /[/\\:\x00-\x1f]/;

/**
 * Validate and merge uploaded reference files into an existing project's list.
 * Enforces file count, size, extension, filename safety, character bounds, and
 * case-insensitive duplicate rejection across both existing and newly added files.
 */
export async function mergeProjectReferences(
  existing: readonly ProjectReference[],
  incoming: readonly IncomingReferenceFile[],
): Promise<ProjectReference[]> {
  if (existing.length + incoming.length > MAX_PROJECT_FILES) {
    throw new Error('Choose up to six reference files.');
  }
  const references = [...existing];
  for (const file of incoming) {
    const name = file.name.trim();
    if (!name || name.startsWith('.') || UNSAFE_NAME_CHARS.test(name) || !VALID_REF_NAME.test(name) || file.size > MAX_PROJECT_FILE_BYTES) {
      throw new Error('Choose Markdown, text, CSV, or JSON files of up to 8,000 characters each.');
    }
    const text = await file.text();
    if (!text.trim() || text.length > MAX_PROJECT_FILE_CHARS) {
      throw new Error(`${name} must contain between 1 and 8,000 characters.`);
    }
    if (references.some((ref) => ref.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`${name} is already in this project.`);
    }
    references.push({ name, text });
  }
  return references;
}
