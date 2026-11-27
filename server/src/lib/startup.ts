export interface StartupListenInfo {
  address: string;
  port: number;
}

export interface StartupLlmSummary {
  provider: string;
  defaultModel: string;
}

/**
 * Formats the server listening log line using the active LLM provider and
 * resolved default model (never API keys or secrets). Preserves the
 * `server on http://127.0.0.1:<port>` prefix matched by desktop smoke tests.
 */
export function formatStartupBanner(info: StartupListenInfo, llm: StartupLlmSummary): string {
  const host = info.address.includes(':') && !info.address.startsWith('[')
    ? `[${info.address}]`
    : info.address;
  const provider = llm.provider.trim() || 'openrouter';
  const model = llm.defaultModel.trim() || 'unset';
  return `[grokbot] server on http://${host}:${info.port} (provider ${provider}, model ${model})`;
}
