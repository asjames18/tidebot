import { useId } from 'react';
import type { AvatarColor, AvatarShape, Bot } from '@shared/types';
import { Icon } from '../components/Icon';
import { SHAPES, type ShapeDef } from './shapes.gen';

const FALLBACK: Partial<Record<AvatarShape, string>> = {
  bean: 'teardrop', squircle: 'square', capsule: 'tablet', cylinder: 'tablet', gem: 'hex', crystal: 'hex',
  shield: 'house', dome: 'house', arch: 'house', leaf: 'teardrop',
};

export function shapeDef(shape: AvatarShape | string): ShapeDef {
  return SHAPES[shape] ?? SHAPES[FALLBACK[shape as AvatarShape] ?? 'blob'] ?? SHAPES.blob;
}

/** Shapes offered in the Create New Operator picker. */
export const PICKER_SHAPES: AvatarShape[] = [
  'blob', 'cloud', 'square', 'sparkle', 'clover', 'heart', 'flower', 'teardrop', 'tablet', 'wedge', 'house', 'star', 'hex',
];

const SHADER_PALETTES: Record<string, { c1: string; c2: string; c3: string; glow: string }> = {
  black:   { c1: '#38BDF8', c2: '#6366F1', c3: '#0F172A', glow: '#38BDF8' },
  blue:    { c1: '#60A5FA', c2: '#2563EB', c3: '#1D4ED8', glow: '#38BDF8' },
  cyan:    { c1: '#22D3EE', c2: '#0284C7', c3: '#0F766E', glow: '#22D3EE' },
  violet:  { c1: '#C084FC', c2: '#7C3AED', c3: '#4338CA', glow: '#A855F7' },
  magenta: { c1: '#F472B6', c2: '#DB2777', c3: '#7E22CE', glow: '#EC4899' },
  green:   { c1: '#34D399', c2: '#059669', c3: '#065F46', glow: '#10B981' },
  yellow:  { c1: '#FBBF24', c2: '#D97706', c3: '#92400E', glow: '#F59E0B' },
  orange:  { c1: '#FB923C', c2: '#EA580C', c3: '#9A3412', glow: '#F97316' },
  red:     { c1: '#F87171', c2: '#DC2626', c3: '#881337', glow: '#EF4444' },
  brown:   { c1: '#D6B38E', c2: '#8B5E34', c3: '#432818', glow: '#D97706' },
  gray:    { c1: '#94A3B8', c2: '#475569', c3: '#1E293B', glow: '#64748B' },
};

function renderGeometricCore(shape: string, gradId: string, accent: string) {
  switch (shape) {
    case 'hex':
    case 'gem':
    case 'crystal':
      return (
        <>
          <polygon points="32,9 52,20.5 52,43.5 32,55 12,43.5 12,20.5" fill={`url(#${gradId})`} fillOpacity="0.24" stroke={`url(#${gradId})`} strokeWidth="2.2" />
          <polygon points="32,15 46,23 46,41 32,49 18,41 18,23" fill={`url(#${gradId})`} fillOpacity="0.55" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="1.2" />
          <path d="M32 9 L32 55 M12 20.5 L52 43.5 M52 20.5 L12 43.5" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="1" />
        </>
      );
    case 'sparkle':
    case 'star':
      return (
        <>
          <circle cx="32" cy="32" r="22" fill={`url(#${gradId})`} fillOpacity="0.18" stroke={`url(#${gradId})`} strokeWidth="1.6" strokeDasharray="4 3" />
          <path d="M32 8 L37.5 26.5 L56 32 L37.5 37.5 L32 56 L26.5 37.5 L8 32 L26.5 26.5 Z" fill={`url(#${gradId})`} stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="1.3" strokeLinejoin="round" />
        </>
      );
    case 'square':
    case 'squircle':
    case 'tablet':
      return (
        <>
          <rect x="11" y="11" width="42" height="42" rx="11" fill={`url(#${gradId})`} fillOpacity="0.24" stroke={`url(#${gradId})`} strokeWidth="2" />
          <rect x="18" y="18" width="28" height="28" rx="6" transform="rotate(45 32 32)" fill={`url(#${gradId})`} fillOpacity="0.6" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="1.2" />
        </>
      );
    case 'wedge':
    case 'house':
    case 'shield':
      return (
        <>
          <polygon points="32,9 54,48 10,48" fill={`url(#${gradId})`} fillOpacity="0.26" stroke={`url(#${gradId})`} strokeWidth="2.2" strokeLinejoin="round" />
          <polygon points="32,18 45,43 19,43" fill={`url(#${gradId})`} fillOpacity="0.65" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="1.2" strokeLinejoin="round" />
          <line x1="32" y1="9" x2="32" y2="48" stroke="#FFFFFF" strokeOpacity="0.28" strokeWidth="1.1" />
        </>
      );
    case 'cloud':
    case 'clover':
    case 'flower':
      return (
        <>
          <circle cx="24" cy="26" r="12" fill={`url(#${gradId})`} fillOpacity="0.45" stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="1.2" />
          <circle cx="40" cy="26" r="12" fill={`url(#${gradId})`} fillOpacity="0.45" stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="1.2" />
          <circle cx="32" cy="39" r="12" fill={`url(#${gradId})`} fillOpacity="0.55" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="1.2" />
          <circle cx="32" cy="31" r="10" fill={`url(#${gradId})`} stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="1.3" />
        </>
      );
    case 'heart':
    case 'teardrop':
      return (
        <>
          <path d="M32 10 C44 22 51 30 51 39 A19 19 0 1 1 13 39 C13 30 20 22 32 10 Z" fill={`url(#${gradId})`} fillOpacity="0.28" stroke={`url(#${gradId})`} strokeWidth="2" />
          <circle cx="32" cy="37" r="11" fill={`url(#${gradId})`} stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1.3" />
        </>
      );
    default:
      // Default: Orbital Sphere & Prism Core ('blob', etc.)
      return (
        <>
          <circle cx="32" cy="32" r="22" fill={`url(#${gradId})`} fillOpacity="0.22" stroke={`url(#${gradId})`} strokeWidth="2" />
          <ellipse cx="32" cy="32" rx="22" ry="9" transform="rotate(-28 32 32)" fill="none" stroke={accent} strokeOpacity="0.65" strokeWidth="1.4" />
          <ellipse cx="32" cy="32" rx="22" ry="9" transform="rotate(32 32 32)" fill="none" stroke="#FFFFFF" strokeOpacity="0.32" strokeWidth="1.2" />
          <polygon points="32,16 46,32 32,48 18,32" fill={`url(#${gradId})`} stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="1.3" strokeLinejoin="round" />
        </>
      );
  }
}

interface Props {
  shape: AvatarShape | string;
  color: AvatarColor | string;
  size: number;
  star?: boolean;
  ring?: boolean;
  className?: string;
  title?: string;
}

export function BotAvatar({ shape, color, size, star, ring, className, title }: Props) {
  const uid = useId().replace(/:/g, '');
  const pal = SHADER_PALETTES[color] ?? SHADER_PALETTES.blue;
  const gradId = `tideCore_${uid}`;
  const bgId = `tideBg_${uid}`;

  return (
    <span
      className={`bot-avatar ${ring ? 'bot-avatar--ring' : ''} ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        '--avatar-glow': pal.glow,
      } as React.CSSProperties}
      title={title}
      role="img"
      aria-label={title}
    >
      <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: 'block', overflow: 'visible' }} aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={pal.c1} />
            <stop offset="55%" stopColor={pal.c2} />
            <stop offset="100%" stopColor={pal.c3} />
          </linearGradient>
          <radialGradient id={bgId} cx="32%" cy="26%" r="75%">
            <stop offset="0%" stopColor={pal.c1} stopOpacity="0.32" />
            <stop offset="55%" stopColor="#0D121F" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#070910" stopOpacity="0.98" />
          </radialGradient>
        </defs>
        {ring && (
          <rect
            x="1"
            y="1"
            width="62"
            height="62"
            rx="19"
            fill="none"
            stroke={pal.c1}
            strokeWidth="2.5"
            strokeOpacity="0.85"
          />
        )}
        <rect
          x="4"
          y="4"
          width="56"
          height="56"
          rx="16"
          fill={`url(#${bgId})`}
          stroke={pal.c1}
          strokeOpacity="0.38"
          strokeWidth="1.5"
        />
        {renderGeometricCore(shape, gradId, pal.c1)}
        <circle cx="32" cy="32" r="3.4" fill="#FFFFFF" />
        <circle cx="32" cy="32" r="6.5" fill={pal.c1} fillOpacity="0.32" />
      </svg>
      {star && (
        <span className="bot-avatar__star" style={{ width: Math.max(12, size * 0.28), height: Math.max(12, size * 0.28) }}>
          <Icon name="star" size={Math.max(8, size * 0.15)} color="#FFFFFF" />
        </span>
      )}
    </span>
  );
}

export function BotAvatarFor({
  bot,
  size,
  star,
  className,
}: {
  bot: Pick<Bot, 'avatarShape' | 'avatarColor' | 'name'> & { isPrimary?: boolean };
  size: number;
  star?: boolean;
  className?: string;
}) {
  return <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} size={size} star={star} className={className} title={bot.name} />;
}
