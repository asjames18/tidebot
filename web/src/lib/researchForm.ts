export const MAX_RESEARCH_SOURCES = 8;
export const MAX_RESEARCH_FILE_PATH = 240;

export interface ResearchDraft {
  question: string;
  outline: string;
  links: string;
  files: string;
}

export interface ResearchPayload {
  question: string;
  outline: string;
  links: string[];
  files: string[];
}

export function parseSourceLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Matches server-side `workspaceFile` validation in `server/src/research.ts`. */
export function isValidResearchFilePath(file: string): boolean {
  const trimmed = file.trim();
  if (!trimmed || trimmed.length > MAX_RESEARCH_FILE_PATH) return false;
  if (!/\.(?:md|txt|csv|json)$/i.test(trimmed)) return false;
  if (/[:\\\x00-\x1f]/.test(trimmed)) return false;
  return trimmed.split('/').every((part) => part !== '' && !part.startsWith('.'));
}

export function filterSelectableResearchFiles(
  entries: readonly { name: string; isDir: boolean }[],
): string[] {
  return entries
    .filter((file) => !file.isDir && isValidResearchFilePath(file.name))
    .map((file) => file.name);
}

export function appendResearchFile(currentFilesText: string, fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return currentFilesText;
  const existing = parseSourceLines(currentFilesText);
  if (existing.includes(trimmed)) return existing.join('\n');
  return [...existing, trimmed].join('\n');
}

export function buildResearchPayload(draft: ResearchDraft): ResearchPayload | null {
  const question = draft.question.trim();
  const outline = draft.outline.trim();
  const links = parseSourceLines(draft.links);
  const files = parseSourceLines(draft.files);
  const total = links.length + files.length;
  if (!question || !outline || total < 1 || total > MAX_RESEARCH_SOURCES) return null;
  return { question, outline, links, files };
}
