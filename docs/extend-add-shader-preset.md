# Tutorial: add a WebGL shader preset

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

Add a shader preset the studio can paint behind the chat. You will add
`ember` — "Ember Drift", slow-rising embers over cooling coals — and finish
with the typecheck/build/test gate plus a live try in the studio. No keys, no
network calls, no new dependencies.

This is tutorial 4 of 4 in the Phase 4 extension series: built-in tool, API
endpoint, model provider, WebGL shader preset.

## Before you start: do you need a new preset?

Add a preset when the look is a distinct mood users pick by name — a new
color story, a new motion, a new texture. If you only want to change the
colors of an existing preset, edit its branch in place: no type, picker, or
cycle change is needed. If your idea is a full-screen effect rather than an
ambient backdrop (particles that react to messages, a game-like scene), it
does not belong in `ShaderCanvas` — that is a new component, not a preset.

## How shader presets work

There is one fragment shader and one `mode` integer. In
`web/src/components/ShaderCanvas.tsx`, `getFragSrc(style)` maps a
`ShaderStyle` to a mode number, and a single GLSL `main()` branches on it.
The `hash` / `noise` / `fbm` helpers above `main()` are shared by every
preset — a new preset reuses them instead of defining its own noise.

The component compiles the shader at runtime and draws a full-screen quad:

- 30 FPS cap, `0.6x` resolution scaling (`0.5x` on screens ≤ 900px wide),
  pauses when off-screen or when the tab is hidden (AGENTS.md §3.5).
- With `prefers-reduced-motion`, it draws exactly one static frame at
  `t = 4.0` — your preset must look intentional frozen at that time, not just
  in motion.

The choice is stored in one SQLite column, `llm_settings.shader_style`
(`server/src/db.ts`), a free-form `TEXT` column with default `'aurora'` and
no value whitelist — `saveLlmConfig()` stores whatever the client sends. A
new preset needs **no migration and no server change** beyond the shared
type. It is rendered as the empty-chat backdrop (`Transcript.tsx`) and picked
in Settings → General & Shaders (`AppSettings.tsx`) or via ⌘K
(`SearchModal.tsx`). Two things are intentionally untouched: the sign-in page
hardcodes `'aurora'` as the brand backdrop (`SignIn.tsx`), and the avatar
palettes in `BotAvatar.tsx` are avatar colors, not shader presets.

## Step 1 — Type

In `server/src/types.ts`, add the preset to the union (the web imports this
type via `@shared/types`):

```ts
export type ShaderStyle = 'aurora' | 'plasma' | 'obsidian' | 'vortex' | 'grid' | 'ember';
```

## Step 2 — Fragment branch

In `web/src/components/ShaderCanvas.tsx`, give the preset the next mode
number. The final `else` is the grid preset, so the new style slots in
before it:

```ts
  const modeIndex = style === 'aurora' ? 0 : style === 'plasma' ? 1 : style === 'obsidian' ? 2 : style === 'vortex' ? 3 : style === 'ember' ? 5 : 4;
```

Add the branch inside `main()`, before the final `else` (grid). Keep it
cheap: reuse `fbm` / `noise` / `hash`, add no loop beyond the ones already
there, and keep the base color dark so chat text stays readable:

```glsl
  } else if (mode == 5) {
    // Ember Drift: slow-rising embers over cooling coals
    vec2 q = vec2(fbm(p * 2.0 + vec2(0.0, -t * 0.22)), fbm(p * 2.0 + vec2(4.7, 2.3 - t * 0.16)));
    float coals = fbm(p * 2.4 + 1.8 * q + vec2(0.0, t * 0.1));
    float heat = smoothstep(0.35, 0.85, coals);
    vec2 sp = vec2(p.x * 5.0, p.y * 5.0 + t * 0.8);
    vec2 cell = floor(sp);
    vec2 f = fract(sp);
    float h = hash(cell);
    vec2 off = vec2(hash(cell + 11.13), hash(cell + 27.71));
    float d = length(f - off);
    float spark = smoothstep(0.14, 0.0, d) * step(0.7, h);
    col = vec3(0.035, 0.02, 0.015);
    col += vec3(0.5, 0.1, 0.02) * heat * 0.85;
    col += vec3(0.85, 0.32, 0.04) * pow(heat, 2.0) * 0.7;
    col += vec3(1.0, 0.72, 0.3) * spark * 0.9;
```

There is no closing `}` on the new branch — the existing `} else {`
(grid) closes it, exactly like every sibling branch above it. A trailing
`}` here would leave the `else` with nothing to attach to and break the
whole shader (all six modes fail to compile).

How it works: `q` domain-warps the coal field, `heat` picks out the glowing
patches, and the sparks are a scrolling cell grid — `sp.y` grows with `t`,
so cells drift upward, `hash(cell)` lights ~30% of them, and `off` puts each
spark at a random spot inside its cell. At the frozen `t = 4.0` frame the
sparks still sit somewhere sensible because their positions come from the
cell hash, not from the clock alone.

If your preset shows nothing at all, the GLSL failed to compile:
`ShaderCanvas` silently drops a failed compile (the `compile()` helper
returns `null` with no log). While developing, temporarily log the error
inside `compile()` — `console.warn(gl.getShaderInfoLog(sh))` before the
`deleteShader` — then remove the log before opening the PR.

## Step 3 — Picker entry

In `web/src/components/config/AppSettings.tsx`, add the preset to
`SHADER_STYLES` so Settings → General & Shaders lists it. The label and
description are what users see; keep the description to one short phrase:

```tsx
  { id: 'ember', label: 'Ember Drift', desc: 'Slow-rising embers over cooling coals' },
```

## Step 4 — ⌘K cycle

In `web/src/components/modals/SearchModal.tsx`, add the preset to the cycle
list and to the hardcoded name list in the subtitle — both are plain arrays,
not derived from `SHADER_STYLES`, so a preset missing here is silently
skipped by ⌘K:

```tsx
          const styles: ShaderStyle[] = ['aurora', 'plasma', 'obsidian', 'vortex', 'grid', 'ember'];
```

```tsx
        sub: `Current: ${(llmConfig?.shaderStyle ?? 'aurora').toUpperCase()} (Aurora · Plasma · Obsidian · Vortex · Grid · Ember)`,
```

## Step 5 — Verify

Run the gate from the repository root:

```bash
npm run typecheck && npm run build && npm test
```

The two known failures on main — root-user env persistence and the sandbox
git wrapper — are pre-existing; your change must not add a third. There is
no automated shader test: `getFragSrc()` is not exported, and the shader
only compiles inside a real WebGL context. The live try in Step 6 is the
verification for the visuals.

## Step 6 — Try it live

1. Start the server and studio (`npm run dev -w server`, `npm run dev -w web`).
2. Open Settings → General & Shaders and pick **Ember Drift** — the empty
   chat backdrop should glow warm, with sparks drifting upward.
3. Press ⌘K, run **Cycle WebGL Ambient Shader**, and confirm Ember Drift
   appears in the rotation and the subtitle names it.
4. Turn on reduced motion (OS setting, or Emulate in DevTools → Rendering)
   and reload: the backdrop should be a single still frame that still reads
   as embers over coals, not a blank or half-drawn field.

## Checklist before your PR

- `npm run typecheck && npm run build && npm test` green (the two known
  failures on main are pre-existing; your change must not add a third).
- The preset looks intentional frozen at `t = 4.0` (reduced-motion frame),
  not just in motion.
- Dark base color, chat text stays readable; no new per-frame loops or
  allocations beyond the AGENTS.md §3.5 budget (30 FPS, `0.6x` scaling).
- The ⌘K subtitle lists the new preset name — it is hardcoded, not derived.
- The sign-in page stays `'aurora'` unless the PR intentionally changes the
  brand backdrop.
- Update `AGENTS.md` §3.5 with the new preset's touch points if you added any
  beyond this tutorial's list.
