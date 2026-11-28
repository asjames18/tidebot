import type { Toolkit } from '@shared/types';

/** Design pill → backend (Composio) category. */
export const APP_CATEGORY_PILLS: readonly { label: string; category: string }[] = [
  { label: 'Password Managers', category: 'security & identity tools' },
  { label: 'Productivity', category: 'productivity' },
  { label: 'Communication', category: 'communication' },
  { label: 'Design', category: 'images & design' },
  { label: 'Code', category: 'developer tools' },
];

export interface SearchKeyLike {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
}

export function titleCaseCategory(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bCrm\b/g, 'CRM')
    .replace(/\bSeo\b/g, 'SEO')
    .replace(/\bIt\b/g, 'IT')
    .replace(/\bHr\b/g, 'HR')
    .replace(/\bSms\b/g, 'SMS')
    .replace(/\bUrl\b/g, 'URL')
    .replace(/\bOcr\b/g, 'OCR');
}

export function isPrimaryAppCategory(cat: string): boolean {
  const lower = cat.trim().toLowerCase();
  return APP_CATEGORY_PILLS.some((p) => p.category === lower);
}

export function categoryPillLabel(cat: string): string {
  const lower = cat.trim().toLowerCase();
  return APP_CATEGORY_PILLS.find((p) => p.category === lower)?.label ?? titleCaseCategory(cat);
}

export function getMoreCategories(categories: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cat of categories) {
    const lower = cat.trim().toLowerCase();
    if (!lower || isPrimaryAppCategory(lower) || seen.has(lower)) continue;
    seen.add(lower);
    out.push(cat);
  }
  return out;
}

/**
 * Partitions connected slugs into those already present in `loadedApps` and only the
 * missing slugs that still require an individual catalog lookup.
 */
export function partitionConnectedSlugs(
  connectedSlugs: readonly string[],
  loadedApps: readonly Toolkit[],
): { resolved: Map<string, Toolkit>; missing: string[] } {
  const bySlug = new Map<string, Toolkit>();
  for (const app of loadedApps) bySlug.set(app.slug, app);

  const resolved = new Map<string, Toolkit>();
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const slug of connectedSlugs) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const found = bySlug.get(slug);
    if (found) resolved.set(slug, { ...found, connected: true });
    else missing.push(slug);
  }
  return { resolved, missing };
}

/**
 * Builds the ordered list of connected toolkits, synthesizing a disconnectable fallback
 * entry for any connected slug that could not be fetched from the catalog.
 */
export function mergeConnectedToolkits(
  connectedSlugs: readonly string[],
  resolved: ReadonlyMap<string, Toolkit>,
): Toolkit[] {
  const seen = new Set<string>();
  const out: Toolkit[] = [];
  for (const slug of connectedSlugs) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const found = resolved.get(slug);
    if (found) {
      out.push({ ...found, connected: true });
    } else {
      out.push({
        slug,
        name: titleCaseCategory(slug.replace(/[_-]+/g, ' ')) || slug,
        description: '',
        categories: [],
        managedAuth: true,
        noAuth: false,
        connected: true,
      });
    }
  }
  return out;
}

export function shouldBlurAppSearchOnEnter(e: SearchKeyLike, viewportWidth: number): boolean {
  if (e.key !== 'Enter') return false;
  if (e.isComposing || e.keyCode === 229) return false;
  return viewportWidth <= 900;
}
