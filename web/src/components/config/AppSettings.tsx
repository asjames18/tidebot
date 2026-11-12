import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LlmProvider, ShaderStyle, Toolkit } from '@shared/types';
import { BotAvatarFor } from '../../avatar/BotAvatar';
import { configApi, type ComputerDetails } from '../../lib/configApi';
import { relativeShort } from '../../lib/time';
import { useConfigUI, type AppSection, type Theme } from '../../configStore';
import { useStore } from '../../store';
import { computerStatusText } from '../DetailsPanel';
import { Icon } from '../Icon';
import { ShaderCanvas } from '../ShaderCanvas';
import { ToolkitLogo } from '../ToolkitLogo';
import { Glyph } from './glyphs';
import { ConfirmButton } from './ui';

const SECTIONS: { id: AppSection; label: string }[] = [
  { id: 'general', label: 'General & Shaders' },
  { id: 'models', label: 'Models & OpenRouter' },
  { id: 'computer', label: 'Computer' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'apps', label: 'Connected apps' },
  { id: 'account', label: 'Account' },
];

const SHADER_STYLES: { id: ShaderStyle; label: string; desc: string }[] = [
  { id: 'aurora', label: 'Aurora Flow', desc: 'Domain-warped oceanic silk ribbons' },
  { id: 'plasma', label: 'Plasma Tide', desc: 'Chromatic harmonic interference field' },
  { id: 'obsidian', label: 'Obsidian Mesh', desc: 'Dark metallic liquid glass with caustics' },
  { id: 'vortex', label: 'Singularity', desc: 'Kinetic radial orbital vortex' },
  { id: 'grid', label: '3D Horizon', desc: 'Perspective cybernetic wave grid' },
];

/** Full-window settings page, opened from the account menu or BYOM pills. */
export function AppSettings() {
  const section = useConfigUI((s) => s.appSettings);
  const close = useConfigUI((s) => s.closeAppSettings);
  const open = useConfigUI((s) => s.openAppSettings);

  const handleClose = () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch {}
    }
    close();
  };

  const handleNav = (id: AppSection) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch {}
    }
    open(id);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-root')) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [close]);
  if (!section) return null;
  return createPortal(
    <div className="app-settings" role="dialog" aria-modal="true" aria-label="Settings">
      <aside className="app-settings__nav">
        <button type="button" className="app-settings__back" onClick={handleClose}>
          <Glyph name="arrow_left" size={14} /> Back to Studio
        </button>
        <div className="app-settings__heading">TideBot Settings</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`cfg-nav__item${section === s.id ? ' is-active' : ''}`}
            onClick={() => handleNav(s.id)}
            aria-current={section === s.id || undefined}
          >
            {s.label}
          </button>
        ))}
      </aside>
      <div className="app-settings__main">
        <button
          type="button"
          className="app-settings__close icon-btn"
          onClick={handleClose}
          aria-label="Close settings"
          title="Close (Esc)"
        >
          <Icon name="close" opacity={0.8} />
        </button>
        <div className="app-settings__page">
          {section === 'general' && <GeneralSection />}
          {section === 'models' && <ModelsSection />}
          {section === 'computer' && <ComputerSection />}
          {section === 'permissions' && <PermissionsSection />}
          {section === 'apps' && <AppsSection />}
          {section === 'account' && <AccountSection />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="app-settings__head">
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThemeTile({ value, label, current, onPick }: { value: Theme; label: string; current: Theme; onPick: (t: Theme) => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={current === value}
      className={`theme-tile${current === value ? ' is-active' : ''}`}
      onClick={() => {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate(8); } catch {}
        }
        onPick(value);
      }}
    >
      <span className={`theme-tile__art is-${value}`} aria-hidden>
        <span className="theme-tile__side" />
        <span className="theme-tile__pane"><i /><i /><b /></span>
      </span>
      <span className="theme-tile__label">{label}</span>
    </button>
  );
}

function GeneralSection() {
  const theme = useConfigUI((s) => s.theme);
  const setTheme = useConfigUI((s) => s.setTheme);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const setLlmConfig = useConfigUI((s) => s.setLlmConfig);
  const openAppSettings = useConfigUI((s) => s.openAppSettings);
  const [health, setHealth] = useState<{ model?: string; providers?: { openrouter?: boolean; custom?: boolean; xai: boolean; composio: boolean; orgo: boolean } } | null>(null);
  const [sysStatus, setSysStatus] = useState<{ bots: number; activeTasks: number; activeRoutines: number; memories: number; messages: number } | null>(null);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
    fetch('/api/system/status', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).then(setSysStatus).catch(() => {});
  }, [llmConfig]);

  const currentShader: ShaderStyle = llmConfig?.shaderStyle ?? 'aurora';

  const pickShader = async (s: ShaderStyle) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch {}
    }
    try {
      const updated = await configApi.saveLlmConfig({ shaderStyle: s });
      setLlmConfig(updated);
    } catch { /* ignore */ }
  };

  const p = health?.providers;
  return (
    <>
      <PageHead title="General & Shaders" sub="Customize TideBot workspace appearance, real-time WebGL shaders, and system integrations." />
      <section className="cfg-section">
        <div className="cfg-section__label">Interface Theme</div>
        <div className="theme-tiles" role="radiogroup" aria-label="Theme">
          <ThemeTile value="dark" label="Obsidian Dark" current={theme} onPick={setTheme} />
          <ThemeTile value="light" label="Alabaster Light" current={theme} onPick={setTheme} />
          <ThemeTile value="system" label="System" current={theme} onPick={setTheme} />
        </div>
        <div className="cfg-field__hint">Obsidian Dark is TideBot’s signature high-contrast glass studio theme.</div>
      </section>

      <section className="cfg-section">
        <div className="cfg-section__label">Ambient WebGL Shader Engine</div>
        <div className="shader-preview-card">
          <ShaderCanvas style={currentShader} className="shader-preview-card__canvas" opacity={0.9} />
          <div className="shader-preview-card__overlay">
            <span className="tideos-pill tideos-pill--glow">REAL-TIME GLSL FRAGMENT SHADER</span>
            <div className="shader-preview-card__title">
              {SHADER_STYLES.find((x) => x.id === currentShader)?.label ?? 'Aurora Flow'}
            </div>
            <div className="shader-preview-card__sub">
              {SHADER_STYLES.find((x) => x.id === currentShader)?.desc}
            </div>
          </div>
        </div>
        <div className="shader-grid">
          {SHADER_STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              className={`shader-Option${currentShader === st.id ? ' is-active' : ''}`}
              onClick={() => void pickShader(st.id)}
            >
              <span className="shader-Option__name">{st.label}</span>
              <span className="shader-Option__desc">{st.desc}</span>
            </button>
          ))}
        </div>
      </section>

      {p && (
        <section className="cfg-section">
          <div className="cfg-section__label">System Telemetry & Providers</div>
          {sysStatus && (
            <div className="sys-telemetry-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: 8, marginBottom: 12 }}>
              {[
                { label: 'Operators', val: sysStatus.bots },
                { label: 'Messages', val: sysStatus.messages },
                { label: 'Memories', val: sysStatus.memories },
                { label: 'Open Tasks', val: sysStatus.activeTasks },
                { label: 'Routines', val: sysStatus.activeRoutines },
              ].map((stat) => (
                <div key={stat.label} className="cfg-card" style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{stat.val}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          )}
          <div className="cfg-card">
            <div className="cfg-row">
              <div className="cfg-row__text">
                <div className="cfg-row__title">
                  Bring Your Own Model ({llmConfig?.provider?.toUpperCase() ?? 'OPENROUTER'} · {llmConfig?.defaultModel ?? health?.model ?? 'anthropic/claude-3.7-sonnet'})
                </div>
                <div className="cfg-row__sub">
                  Route operators through OpenRouter (Claude, Gemini, GPT-4.1, DeepSeek, Llama, Grok) or any OpenAI-compatible endpoint.
                </div>
              </div>
              <button type="button" className="cfg-btn cfg-btn--primary" onClick={() => openAppSettings('models')}>
                Configure BYOM
              </button>
            </div>
            <div className="cfg-row">
              <div className="cfg-row__text">
                <div className="cfg-row__title">Composio App Marketplace & Triggers</div>
                <div className="cfg-row__sub">Powers 1,000+ app connectors, OAuth sign-in, and event triggers via <code className="cfg-code">COMPOSIO_API_KEY</code>.</div>
              </div>
              <span className={`cfg-chip${p.composio ? '' : ' cfg-chip--muted'}`}>{p.composio ? 'Configured' : 'Catalog preview'}</span>
            </div>
            <div className="cfg-row">
              <div className="cfg-row__text">
                <div className="cfg-row__title">Orgo Cloud Computer</div>
                <div className="cfg-row__sub">Provides persistent Linux desktops and isolated Xvfb screens via <code className="cfg-code">ORGO_API_KEY</code>.</div>
              </div>
              <span className={`cfg-chip${p.orgo ? '' : ' cfg-chip--muted'}`}>{p.orgo ? 'Configured' : 'Not configured'}</span>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function ModelsSection() {
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const setLlmConfig = useConfigUI((s) => s.setLlmConfig);
  const curatedModels = useConfigUI((s) => s.curatedModels);
  const remoteModels = useConfigUI((s) => s.remoteModels);
  const loadModels = useConfigUI((s) => s.loadModels);

  const [provider, setProvider] = useState<LlmProvider>(llmConfig?.provider ?? 'openrouter');
  const [defaultModel, setDefaultModel] = useState(llmConfig?.defaultModel ?? 'anthropic/claude-3.7-sonnet');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState(llmConfig?.customBaseUrl ?? '');
  const [customApiKey, setCustomApiKey] = useState('');
  const [xaiKey, setXaiKey] = useState('');
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'free' | 'vision' | 'fast'>('all');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!curatedModels.length) void loadModels();
  }, [curatedModels.length, loadModels]);

  useEffect(() => {
    if (llmConfig) {
      setProvider(llmConfig.provider);
      setDefaultModel(llmConfig.defaultModel);
      setCustomBaseUrl(llmConfig.customBaseUrl);
    }
  }, [llmConfig]);

  const save = async (overrideModel?: string) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(12); } catch {}
    }
    setSaving(true);
    setStatusMsg(null);
    try {
      const payload: Parameters<typeof configApi.saveLlmConfig>[0] = {
        provider,
        defaultModel: (overrideModel ?? defaultModel).trim(),
        customBaseUrl: customBaseUrl.trim(),
      };
      if (openrouterKey.trim()) payload.openrouterKey = openrouterKey.trim();
      if (customApiKey.trim()) payload.customApiKey = customApiKey.trim();
      if (xaiKey.trim()) payload.xaiKey = xaiKey.trim();

      const updated = await configApi.saveLlmConfig(payload);
      setLlmConfig(updated);
      setOpenrouterKey('');
      setCustomApiKey('');
      setXaiKey('');
      setStatusMsg({ ok: true, text: `Saved BYOM configuration (${updated.provider.toUpperCase()} · ${updated.defaultModel})` });
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e?.message ?? 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  const testConn = async () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setTesting(true);
    setStatusMsg(null);
    try {
      // Save any pending inputs first so the test uses them
      if (openrouterKey.trim() || customApiKey.trim() || xaiKey.trim() || defaultModel !== llmConfig?.defaultModel || provider !== llmConfig?.provider) {
        await save();
      }
      const res = await configApi.testLlm();
      if (res.ok) {
        setStatusMsg({ ok: true, text: `Connected to ${res.model} (${res.latencyMs}ms): "${res.reply}"` });
      } else {
        setStatusMsg({ ok: false, text: `Connection test failed: ${res.error}` });
      }
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e?.message ?? 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const { allModels, totalCount, freeCount } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const seen = new Set<string>();
    const unique = [...curatedModels, ...remoteModels].filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    const isFree = (m: (typeof unique)[0]) => m.id.includes(':free') || (m.badge && m.badge.toLowerCase().includes('free'));
    const freeTotal = unique.filter(isFree).length;

    let filtered = unique;
    if (filterTab === 'free') {
      filtered = filtered.filter(isFree);
    } else if (filterTab === 'vision') {
      filtered = filtered.filter((m) => m.vision);
    } else if (filterTab === 'fast') {
      filtered = filtered.filter((m) => m.name.toLowerCase().includes('flash') || m.name.toLowerCase().includes('mini') || m.id.includes('flash') || m.id.includes('mini'));
    }

    if (q) {
      filtered = filtered.filter((m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (m.badge && m.badge.toLowerCase().includes(q))
      );
    }

    return {
      allModels: filtered.slice(0, 80),
      totalCount: unique.length,
      freeCount: freeTotal,
    };
  }, [curatedModels, remoteModels, search, filterTab]);

  return (
    <>
      <PageHead
        title="Models & OpenRouter (BYOM)"
        sub="Bring Your Own Model to TideBot. Use OpenRouter for 250+ frontier models (Claude, Gemini, GPT-4.1, DeepSeek, Llama, Grok) or connect any custom OpenAI-compatible server."
      />

      <section className="cfg-section">
        <div className="cfg-section__label">1. Select Model Provider</div>
        <div className="byom-provider-grid">
          <button
            type="button"
            className={`byom-provider-card${provider === 'openrouter' ? ' is-active' : ''}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(8); } catch {}
              }
              setProvider('openrouter');
              if (defaultModel === 'grok-4.7') setDefaultModel('anthropic/claude-3.7-sonnet');
            }}
          >
            <div className="byom-provider-card__top">
              <span className="byom-provider-card__title">OpenRouter</span>
              <span className="tideos-pill tideos-pill--glow">Recommended</span>
            </div>
            <div className="byom-provider-card__sub">
              One API key for Claude 3.7/4, Gemini 2.5 Pro, GPT-4.1, DeepSeek R1/V3, Llama 4, and Grok 3.
            </div>
          </button>

          <button
            type="button"
            className={`byom-provider-card${provider === 'custom' ? ' is-active' : ''}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(8); } catch {}
              }
              setProvider('custom');
            }}
          >
            <div className="byom-provider-card__top">
              <span className="byom-provider-card__title">Custom Endpoint</span>
              <span className="tideos-pill">OpenAI API</span>
            </div>
            <div className="byom-provider-card__sub">
              Connect Ollama, LM Studio, vLLM, OpenAI, Together, or Groq via Base URL.
            </div>
          </button>

          <button
            type="button"
            className={`byom-provider-card${provider === 'xai' ? ' is-active' : ''}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(8); } catch {}
              }
              setProvider('xai');
              if (defaultModel.includes('/')) setDefaultModel('grok-4.7');
            }}
          >
            <div className="byom-provider-card__top">
              <span className="byom-provider-card__title">xAI Direct</span>
              <span className="tideos-pill">Responses API</span>
            </div>
            <div className="byom-provider-card__sub">
              Direct xAI `/v1/responses` engine with native Grok models.
            </div>
          </button>
        </div>
      </section>

      <section className="cfg-section">
        <div className="cfg-section__label">2. Credentials & Default Model</div>
        <div className="cfg-card cfg-card--padded">
          {provider === 'openrouter' && (
            <div className="cfg-field">
              <label className="cfg-field__label">
                OpenRouter API Key
                {llmConfig?.hasOpenrouterKey && (
                  <span className="cfg-chip" style={{ marginLeft: 8 }}>Active: {llmConfig.openrouterKeyHint}</span>
                )}
              </label>
              <input
                type="password"
                className="cfg-input"
                placeholder={llmConfig?.hasOpenrouterKey ? 'Paste new key to replace saved key (sk-or-v1-...)' : 'sk-or-v1-...'}
                value={openrouterKey}
                onChange={(e) => setOpenrouterKey(e.target.value)}
              />
              <div className="cfg-field__hint">
                Get an API key at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>. Stored locally in your TideBot SQLite database (or set <code className="cfg-code">OPENROUTER_API_KEY</code> in <code className="cfg-code">.env</code>).
              </div>
            </div>
          )}

          {provider === 'custom' && (
            <>
              <div className="cfg-field">
                <label className="cfg-field__label">OpenAI-Compatible Base URL</label>
                <input
                  type="text"
                  className="cfg-input"
                  placeholder="e.g. http://localhost:11434/v1 or https://api.openai.com/v1"
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                />
              </div>
              <div className="cfg-field">
                <label className="cfg-field__label">
                  API Key (optional for local Ollama/LM Studio)
                  {llmConfig?.hasCustomKey && (
                    <span className="cfg-chip" style={{ marginLeft: 8 }}>Active: {llmConfig.customKeyHint}</span>
                  )}
                </label>
                <input
                  type="password"
                  className="cfg-input"
                  placeholder="sk-..."
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                />
              </div>
            </>
          )}

          {provider === 'xai' && (
            <div className="cfg-field">
              <label className="cfg-field__label">
                xAI API Key
                {llmConfig?.hasXaiKey && (
                  <span className="cfg-chip" style={{ marginLeft: 8 }}>Active: {llmConfig.xaiKeyHint}</span>
                )}
              </label>
              <input
                type="password"
                className="cfg-input"
                placeholder={llmConfig?.hasXaiKey ? 'Paste new xAI key to replace saved key' : 'xai-...'}
                value={xaiKey}
                onChange={(e) => setXaiKey(e.target.value)}
              />
            </div>
          )}

          <div className="cfg-field" style={{ marginTop: 14 }}>
            <label className="cfg-field__label">Global Default Model ID</label>
            <input
              type="text"
              className="cfg-input"
              placeholder="e.g. anthropic/claude-3.7-sonnet"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
            />
            <div className="cfg-field__hint">
              Every operator uses this model unless you assign a specific model override in that operator’s settings or chat header.
            </div>
          </div>

          <div className="byom-actions">
            <button type="button" className="cfg-btn cfg-btn--primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save Configuration'}
            </button>
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={testing} onClick={() => void testConn()}>
              {testing ? 'Pinging Model…' : 'Test Connection'}
            </button>
          </div>

          {statusMsg && (
            <div className={`byom-status ${statusMsg.ok ? 'is-ok' : 'is-err'}`}>
              {statusMsg.text}
            </div>
          )}
        </div>
      </section>

      <section className="cfg-section">
        <div className="cfg-section__label-row">
          <span className="cfg-section__label">3. OpenRouter Model Catalog ({totalCount || curatedModels.length + remoteModels.length} available)</span>
          <input
            type="search"
            className="cfg-input byom-search"
            placeholder="Filter models (e.g. claude, gemini, deepseek, gpt-4.1, llama)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="byom-filter-tabs" role="tablist" aria-label="Model filters">
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'all'}
            className={`byom-filter-tab${filterTab === 'all' ? ' is-active' : ''}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(8); } catch {}
              }
              setFilterTab('all');
            }}
          >
            All Models ({totalCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'free'}
            className={`byom-filter-tab byom-filter-tab--free${filterTab === 'free' ? ' is-active' : ''}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(8); } catch {}
              }
              setFilterTab('free');
            }}
          >
            🎁 100% Free (:free) ({freeCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'vision'}
            className={`byom-filter-tab${filterTab === 'vision' ? ' is-active' : ''}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(8); } catch {}
              }
              setFilterTab('vision');
            }}
          >
            👁️ Vision
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'fast'}
            className={`byom-filter-tab${filterTab === 'fast' ? ' is-active' : ''}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(8); } catch {}
              }
              setFilterTab('fast');
            }}
          >
            ⚡ Fast
          </button>
        </div>

        <div className="byom-model-grid">
          {allModels.map((m) => {
            const active = defaultModel === m.id;
            const isFree = m.id.includes(':free') || (m.badge && m.badge.toLowerCase().includes('free'));
            return (
              <button
                key={m.id}
                type="button"
                className={`byom-model-card${active ? ' is-active' : ''}${isFree ? ' is-free' : ''}`}
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(10); } catch {}
                  }
                  setDefaultModel(m.id);
                  void save(m.id);
                }}
              >
                <div className="byom-model-card__top">
                  <span className="byom-model-card__name">
                    {active && <span className="byom-model-card__check" aria-hidden="true">✓ </span>}
                    {m.name}
                  </span>
                  <div className="byom-model-card__badges">
                    {isFree && <span className="byom-model-card__free-tag">FREE</span>}
                    {m.badge && <span className="byom-model-card__badge">{m.badge}</span>}
                  </div>
                </div>
                <div className="byom-model-card__id">{m.id}</div>
                <div className="byom-model-card__meta">
                  <span>{m.provider}</span>
                  <span>•</span>
                  <span>{Math.round(m.contextLength / 1000)}k ctx</span>
                  {m.vision && (
                    <>
                      <span>•</span>
                      <span>Vision</span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

const screenLabel = (id: string) => (id === 'default' ? 'Main screen' : `Screen ${Number(id.replace('screen-', '')) - 98 || id}`);

function ComputerSection() {
  const computer = useStore((s) => s.computer);
  const bots = useStore((s) => s.bots);
  const [details, setDetails] = useState<ComputerDetails | null>(null);
  const [busy, setBusy] = useState<'wake' | 'sleep' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => { configApi.computerDetails().then(setDetails).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load, computer?.status, computer?.screens.length]);

  const status = computer?.status ?? details?.computer.status;
  const running = status === 'running';
  const transitioning = status === 'starting' || status === 'resuming' || status === 'creating' || status === 'suspending';
  const act = async (kind: 'wake' | 'sleep') => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setBusy(kind); setNote(null);
    try { kind === 'wake' ? await configApi.wake() : await configApi.sleep(); }
    catch (e) { setNote((e as Error).message); }
    finally { setBusy(null); }
  };
  const byId = new Map(bots.map((b) => [b.id, b]));

  return (
    <>
      <PageHead title="Computer" sub="Your Operators share one cloud computer. Each Operator works on its own isolated screen." />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row">
            <span className={`computer-status-dot is-${running ? 'on' : transitioning ? 'busy' : 'off'}`} aria-hidden />
            <div className="cfg-row__text">
              <div className="cfg-row__title">Operators’ computer · {computerStatusText(computer ?? null)}</div>
              <div className="cfg-row__sub">
                {details ? `Goes to sleep after ${details.hibernation.idleMinutes} idle minutes when nobody is watching. Starts again on its own once an Operator has work.` : 'Checking…'}
              </div>
            </div>
            {running || status === 'suspending' ? (
              <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!running || !!busy} onClick={() => act('sleep')}>{busy === 'sleep' || status === 'suspending' ? 'Going to sleep…' : 'Sleep'}</button>
            ) : (
              <button type="button" className="cfg-btn cfg-btn--primary" disabled={transitioning || !!busy} onClick={() => act('wake')}>{busy === 'wake' || transitioning ? 'Waking…' : 'Wake'}</button>
            )}
          </div>
          {computer?.error && status === 'error' && <div className="cfg-error cfg-error--inset">{computer.error}</div>}
          {note && <div className="cfg-error cfg-error--inset">{note}</div>}
        </div>
      </section>

      <section className="cfg-section">
        <div className="cfg-section__label">Screens in use</div>
        <div className="cfg-card">
          {!details ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : details.screens.length === 0 ? (
            <div className="cfg-empty cfg-empty--flat">No Operator has used the computer yet.</div>
          ) : details.screens.map((s) => {
            const bot = byId.get(s.botId);
            return (
              <div key={s.botId} className="cfg-row">
                {bot ? <BotAvatarFor bot={bot} size={28} /> : <span className="cfg-row__ph" />}
                <div className="cfg-row__text">
                  <div className="cfg-row__title">{bot?.name ?? 'Removed Operator'}</div>
                  <div className="cfg-row__sub">{screenLabel(s.screenId)} · used {relativeShort(s.lastUsedAt) === 'now' ? 'just now' : `${relativeShort(s.lastUsedAt)}${/^\d/.test(relativeShort(s.lastUsedAt)) ? ' ago' : ''}`}</div>
                </div>
                <ConfirmButton
                  className="cfg-btn cfg-btn--secondary"
                  confirmLabel="Reset screen"
                  disabled={!running}
                  title={running ? 'Closes everything open on this screen' : 'Wake the computer first'}
                  onConfirm={async () => {
                    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                      try { navigator.vibrate(12); } catch {}
                    }
                    try { await configApi.resetScreen(s.botId); setNote(null); load(); } catch (e) { setNote((e as Error).message); }
                  }}
                >
                  Reset
                </ConfirmButton>
              </div>
            );
          })}
        </div>
        <div className="cfg-field__hint">Reset closes every window on that Operator’s screen, so it starts clean next time. Up to 4 Operators can have a screen at once.</div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function humanizeTool(slug: string): { app: string; action: string } {
  const parts = slug.split(/[_:]/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (parts.length < 2) return { app: cap(slug), action: '' };
  return { app: cap(parts[0]), action: cap(parts.slice(1).join(' ')) };
}

function PermissionsSection() {
  const [policies, setPolicies] = useState<{ tool: string; mode: string }[] | null>(null);
  const load = useCallback(() => { configApi.policies().then((r) => setPolicies(r.policies)).catch(() => setPolicies([])); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <PageHead title="Permissions" sub="Actions your Operators can take without asking first. Remove one and they’ll ask again next time." />
      <section className="cfg-section">
        <div className="cfg-card">
          {policies === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : policies.length === 0 ? (
            <div className="cfg-empty cfg-empty--flat">Nothing here yet. When you choose “Always allow” on an approval, it shows up here.</div>
          ) : policies.map((p) => {
            const h = humanizeTool(p.tool);
            return (
              <div key={p.tool} className="cfg-row">
                <div className="cfg-row__text">
                  <div className="cfg-row__title">{h.app}{h.action ? ` · ${h.action}` : ''}</div>
                  <div className="cfg-row__sub">{p.mode === 'always_allow' ? 'Always allowed' : p.mode === 'blocked' ? 'Never allowed' : 'Asks first'} · <code className="cfg-code">{p.tool}</code></div>
                </div>
                <button
                  type="button"
                  className="cfg-btn cfg-btn--secondary"
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                      try { navigator.vibrate(8); } catch {}
                    }
                    configApi.deletePolicy(p.tool).then(load).catch(() => {});
                  }}
                >
                  Ask again
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function AppsSection() {
  const version = useStore((s) => s.connectionsVersion);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const setLlmConfig = useConfigUI((s) => s.setLlmConfig);
  const [apps, setApps] = useState<Toolkit[] | null>(null);
  const [composioKey, setComposioKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyNote, setKeyNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { configApi.connectedApps().then((r) => setApps(r.connectedApps ?? [])).catch(() => setApps([])); }, [version]);
  const openApps = () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch {}
    }
    useConfigUI.getState().closeAppSettings();
    useStore.getState().setModal('apps');
  };

  const saveComposioKey = async () => {
    if (!composioKey.trim()) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(12); } catch {}
    }
    setSavingKey(true);
    setKeyNote(null);
    try {
      const updated = await configApi.saveLlmConfig({ composioKey: composioKey.trim() });
      setLlmConfig(updated);
      setComposioKey('');
      const st = useStore.getState();
      st.set({ connectionsVersion: st.connectionsVersion + 1 });
      setKeyNote({ ok: true, text: 'Saved Composio API key to .env and reloaded catalog.' });
    } catch (e: any) {
      setKeyNote({ ok: false, text: e?.message ?? 'Failed to save key' });
    } finally {
      setSavingKey(false);
    }
  };

  const testComposio = async () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setTestingKey(true);
    setKeyNote(null);
    try {
      if (composioKey.trim()) await saveComposioKey();
      const res = await configApi.testComposio();
      if (res.ok) {
        setKeyNote({ ok: true, text: `Composio connected (${res.count} app toolkits ready in ${res.latencyMs}ms)` });
        const st = useStore.getState();
        st.set({ connectionsVersion: st.connectionsVersion + 1 });
      } else {
        setKeyNote({ ok: false, text: res.error ?? 'Composio test failed' });
      }
    } catch (e: any) {
      setKeyNote({ ok: false, text: e?.message ?? 'Composio test failed' });
    } finally {
      setTestingKey(false);
    }
  };

  return (
    <>
      <PageHead title="Connected apps (Composio)" sub="Apps your Operators can use for you, like Gmail, Google Calendar, GitHub, Slack, Notion, and Linear." />
      <section className="cfg-section">
        <div className="cfg-section__label">Composio Engine Status</div>
        <div className="cfg-card cfg-card--padded">
          <div className="cfg-field">
            <label className="cfg-field__label">
              Composio API Key
              {llmConfig?.hasComposioKey ? (
                <span className="cfg-chip" style={{ marginLeft: 8 }}>Active: {llmConfig.composioKeyHint}</span>
              ) : (
                <span className="cfg-chip" style={{ marginLeft: 8, opacity: 0.7 }}>Unconfigured</span>
              )}
            </label>
            <input
              type="password"
              className="cfg-input"
              placeholder={llmConfig?.hasComposioKey ? 'Paste new key to replace saved COMPOSIO_API_KEY (ak_...)' : 'ak_...'}
              value={composioKey}
              onChange={(e) => setComposioKey(e.target.value)}
            />
            <div className="cfg-field__hint">
              Get your key at <a href="https://app.composio.dev" target="_blank" rel="noreferrer">app.composio.dev</a>. Hot-reloads immediately without restarting the server.
            </div>
          </div>
          <div className="byom-actions">
            {composioKey.trim() && (
              <button type="button" className="cfg-btn cfg-btn--primary" disabled={savingKey} onClick={() => void saveComposioKey()}>
                {savingKey ? 'Saving…' : 'Save Key'}
              </button>
            )}
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={testingKey} onClick={() => void testComposio()}>
              {testingKey ? 'Verifying…' : 'Test Composio Catalog'}
            </button>
            <button type="button" className="cfg-btn cfg-btn--primary" onClick={openApps}>
              Browse & Connect Apps
            </button>
          </div>
          {keyNote && (
            <div className={`byom-status ${keyNote.ok ? 'is-ok' : 'is-err'}`}>
              {keyNote.text}
            </div>
          )}
        </div>
      </section>

      <section className="cfg-section">
        <div className="cfg-section__label">Active App Connections</div>
        <div className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">{apps === null ? 'Checking…' : apps.length ? `${apps.length} app${apps.length === 1 ? '' : 's'} connected` : 'No apps connected yet'}</div>
              <div className="cfg-row__sub">Operators ask before doing anything that changes data in an app.</div>
            </div>
            <button type="button" className="cfg-btn cfg-btn--primary" onClick={openApps}>{apps?.length ? 'Manage apps' : 'Connect apps'}</button>
          </div>
          {apps?.map((a) => (
            <div key={a.slug} className="cfg-row">
              <ToolkitLogo name={a.name} logo={a.logo} size={28} radius={7} />
              <div className="cfg-row__text">
                <div className="cfg-row__title">{a.name}</div>
                {a.description && <div className="cfg-row__sub">{a.description}</div>}
              </div>
              <span className="cfg-chip">Connected</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function AccountSection() {
  const user = useStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  const initials = (user?.name ?? user?.email ?? '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <>
      <PageHead title="Account" />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row">
            <span className="account__initials">{initials}</span>
            <div className="cfg-row__text">
              <div className="cfg-row__title">{user?.name}</div>
              <div className="cfg-row__sub">{user?.email}</div>
            </div>
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={busy} onClick={async () => { setBusy(true); await configApi.logout().catch(() => {}); location.reload(); }}>
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
