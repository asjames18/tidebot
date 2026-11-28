import type { AvatarColor, AvatarShape, OperatorTemplate, OperatorTemplateSkill } from '../types.js';
import { redactSecrets } from './redact.js';

export const OPERATOR_TEMPLATE_SCHEMA = 'tidebot.operator.v1' as const;

export const ALLOWED_SHAPES: readonly AvatarShape[] = [
  'blob', 'pebble', 'bean', 'egg', 'squircle', 'tablet', 'capsule', 'cylinder', 'hex',
  'gem', 'crystal', 'wedge', 'shield', 'dome', 'arch', 'cloud', 'teardrop', 'leaf',
  'square', 'sparkle', 'clover', 'flower', 'heart', 'house', 'star',
];

export const ALLOWED_COLORS: readonly AvatarColor[] = [
  'black', 'brown', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta', 'gray',
];

const ALLOWED_MODES = new Set(['personal', 'teammate']);
const ALLOWED_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'schema',
  'name',
  'label',
  'description',
  'instructions',
  'model',
  'mode',
  'effort',
  'avatarShape',
  'avatarColor',
  'tools',
  'memorySeed',
]);

const ALLOWED_SKILL_KEYS = new Set(['name', 'description', 'body']);

const SECRET_KEY_PATTERN = /(?:key|token|auth(?:orization)?|credential|cookie|password|secret|session|env)$/i;

/** Defense-in-depth scrub for common API key/token patterns accidentally pasted into text fields. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-or-v1-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bxai-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:ak|orgo)_[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g,
];

function scrubText(text: string, extraSecrets: string[] = []): string {
  let out = redactSecrets(text, extraSecrets);
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }
  return out;
}

export interface ValidatedOperatorTemplate {
  schema: typeof OPERATOR_TEMPLATE_SCHEMA;
  name: string;
  label: string;
  description: string;
  instructions: string;
  model: string;
  mode: 'personal' | 'teammate';
  effort: 'low' | 'medium' | 'high' | 'xhigh';
  avatarShape?: AvatarShape;
  avatarColor?: AvatarColor;
  tools: OperatorTemplateSkill[];
  memorySeed: string[];
}

export type TemplateValidationResult =
  | { ok: true; template: ValidatedOperatorTemplate }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readOptionalString(
  obj: Record<string, unknown>,
  field: string,
  maxLen: number,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = obj[field];
  if (raw === undefined) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: `Field "${field}" must be a string.` };
  const trimmed = raw.trim();
  if (trimmed.length > maxLen) {
    return { ok: false, error: `Field "${field}" exceeds maximum length of ${maxLen} characters.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Strictly validate an untrusted Operator template payload before import.
 * Never imports blindly: rejects malformed JSON shapes, unknown or secret-bearing
 * fields, invalid enums, and oversized arrays with a clear human-readable error.
 */
export function validateOperatorTemplate(input: unknown): TemplateValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: 'Operator template must be a JSON object.' };
  }

  for (const key of Object.keys(input)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      return { ok: false, error: `Template must not include secret or credential field "${key}".` };
    }
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return { ok: false, error: `Unknown field "${key}" in Operator template.` };
    }
  }

  if (input.schema !== OPERATOR_TEMPLATE_SCHEMA) {
    return {
      ok: false,
      error: `Unsupported or missing template schema (expected "${OPERATOR_TEMPLATE_SCHEMA}").`,
    };
  }

  if (typeof input.name !== 'string' || !input.name.trim()) {
    return { ok: false, error: 'Field "name" is required and must be a non-empty string.' };
  }
  const name = input.name.trim();
  if (name.length > 60) {
    return { ok: false, error: 'Field "name" exceeds maximum length of 60 characters.' };
  }

  const label = readOptionalString(input, 'label', 60);
  if (!label.ok) return label;
  const description = readOptionalString(input, 'description', 500);
  if (!description.ok) return description;
  const instructions = readOptionalString(input, 'instructions', 16_000);
  if (!instructions.ok) return instructions;
  const model = readOptionalString(input, 'model', 160);
  if (!model.ok) return model;
  if (/[\r\n]/.test(model.value)) {
    return { ok: false, error: 'Field "model" must not contain line breaks.' };
  }

  let mode: 'personal' | 'teammate' = 'personal';
  if (input.mode !== undefined) {
    if (typeof input.mode !== 'string' || !ALLOWED_MODES.has(input.mode)) {
      return { ok: false, error: 'Field "mode" must be "personal" or "teammate".' };
    }
    mode = input.mode as 'personal' | 'teammate';
  }

  let effort: 'low' | 'medium' | 'high' | 'xhigh' = 'medium';
  if (input.effort !== undefined) {
    if (typeof input.effort !== 'string' || !ALLOWED_EFFORTS.has(input.effort)) {
      return { ok: false, error: 'Field "effort" must be one of "low", "medium", "high", or "xhigh".' };
    }
    effort = input.effort as 'low' | 'medium' | 'high' | 'xhigh';
  }

  let avatarShape: AvatarShape | undefined;
  if (input.avatarShape !== undefined) {
    if (typeof input.avatarShape !== 'string' || !ALLOWED_SHAPES.includes(input.avatarShape as AvatarShape)) {
      return { ok: false, error: `Invalid avatarShape "${String(input.avatarShape)}".` };
    }
    avatarShape = input.avatarShape as AvatarShape;
  }

  let avatarColor: AvatarColor | undefined;
  if (input.avatarColor !== undefined) {
    if (typeof input.avatarColor !== 'string' || !ALLOWED_COLORS.includes(input.avatarColor as AvatarColor)) {
      return { ok: false, error: `Invalid avatarColor "${String(input.avatarColor)}".` };
    }
    avatarColor = input.avatarColor as AvatarColor;
  }

  const tools: OperatorTemplateSkill[] = [];
  if (input.tools !== undefined) {
    if (!Array.isArray(input.tools)) {
      return { ok: false, error: 'Field "tools" must be an array.' };
    }
    if (input.tools.length > 50) {
      return { ok: false, error: 'Field "tools" cannot contain more than 50 entries.' };
    }
    for (let i = 0; i < input.tools.length; i++) {
      const item = input.tools[i];
      if (!isPlainObject(item)) {
        return { ok: false, error: `Tool entry at index ${i} must be an object.` };
      }
      for (const key of Object.keys(item)) {
        if (SECRET_KEY_PATTERN.test(key)) {
          return { ok: false, error: `Tool entry at index ${i} must not include secret field "${key}".` };
        }
        if (!ALLOWED_SKILL_KEYS.has(key)) {
          return { ok: false, error: `Unknown field "${key}" in tool entry at index ${i}.` };
        }
      }
      if (typeof item.name !== 'string' || !item.name.trim()) {
        return { ok: false, error: `Tool entry at index ${i} requires a non-empty "name".` };
      }
      const toolName = item.name.trim();
      if (toolName.length > 100) {
        return { ok: false, error: `Tool entry "${toolName.slice(0, 20)}..." name exceeds 100 characters.` };
      }
      const toolDesc = readOptionalString(item, 'description', 300);
      if (!toolDesc.ok) return { ok: false, error: `Tool entry at index ${i}: ${toolDesc.error}` };
      if (typeof item.body !== 'string' || !item.body.trim()) {
        return { ok: false, error: `Tool entry at index ${i} requires a non-empty "body".` };
      }
      const toolBody = item.body.trim();
      if (toolBody.length > 16_000) {
        return { ok: false, error: `Tool entry "${toolName}" body exceeds 16000 characters.` };
      }
      tools.push({ name: toolName, description: toolDesc.value, body: toolBody });
    }
  }

  const memorySeed: string[] = [];
  if (input.memorySeed !== undefined) {
    if (!Array.isArray(input.memorySeed)) {
      return { ok: false, error: 'Field "memorySeed" must be an array of strings.' };
    }
    if (input.memorySeed.length > 100) {
      return { ok: false, error: 'Field "memorySeed" cannot contain more than 100 entries.' };
    }
    for (let i = 0; i < input.memorySeed.length; i++) {
      const entry = input.memorySeed[i];
      if (typeof entry !== 'string' || !entry.trim()) {
        return { ok: false, error: `Memory seed entry at index ${i} must be a non-empty string.` };
      }
      const clean = entry.trim();
      if (clean.length > 1000) {
        return { ok: false, error: `Memory seed entry at index ${i} exceeds 1000 characters.` };
      }
      memorySeed.push(clean);
    }
  }

  return {
    ok: true,
    template: {
      schema: OPERATOR_TEMPLATE_SCHEMA,
      name,
      label: label.value,
      description: description.value,
      instructions: instructions.value,
      model: model.value,
      mode,
      effort,
      avatarShape,
      avatarColor,
      tools,
      memorySeed,
    },
  };
}

/**
 * Build a shareable, secret-free Operator template object from a bot's DB rows.
 * Only allowlisted fields are included, and text fields are scrubbed of known
 * secrets and common API token formats.
 */
export function buildOperatorTemplate(
  bot: {
    name: string;
    label?: string | null;
    description?: string | null;
    instructions?: string | null;
    model?: string | null;
    mode?: string | null;
    effort?: string | null;
    avatar_shape?: string | null;
    avatar_color?: string | null;
  },
  skills: { name: string; description?: string | null; body: string }[],
  memories: { text: string }[],
  extraSecrets: string[] = [],
): OperatorTemplate {
  const mode: 'personal' | 'teammate' = bot.mode === 'teammate' ? 'teammate' : 'personal';
  const effort = (ALLOWED_EFFORTS.has(String(bot.effort ?? '')) ? bot.effort : 'medium') as OperatorTemplate['effort'];
  const avatarShape = ALLOWED_SHAPES.includes(bot.avatar_shape as AvatarShape) ? (bot.avatar_shape as AvatarShape) : undefined;
  const avatarColor = ALLOWED_COLORS.includes(bot.avatar_color as AvatarColor) ? (bot.avatar_color as AvatarColor) : undefined;

  return {
    schema: OPERATOR_TEMPLATE_SCHEMA,
    name: scrubText(bot.name ?? '', extraSecrets).trim() || 'Operator',
    label: scrubText(bot.label ?? '', extraSecrets).trim(),
    description: scrubText(bot.description ?? '', extraSecrets).trim(),
    instructions: scrubText(bot.instructions ?? '', extraSecrets).trim(),
    model: (bot.model ?? '').trim(),
    mode,
    effort,
    ...(avatarShape ? { avatarShape } : {}),
    ...(avatarColor ? { avatarColor } : {}),
    tools: skills
      .map((s) => ({
        name: scrubText(s.name, extraSecrets).trim(),
        description: scrubText(s.description ?? '', extraSecrets).trim(),
        body: scrubText(s.body, extraSecrets).trim(),
      }))
      .filter((s) => s.name && s.body),
    memorySeed: memories
      .map((m) => scrubText(m.text, extraSecrets).trim())
      .filter(Boolean),
  };
}

export function operatorTemplateFilename(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'operator';
  return `${slug}.tidebot.json`;
}
