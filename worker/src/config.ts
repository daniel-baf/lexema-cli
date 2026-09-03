import { getProvider } from './ai';

export interface ResolvedConfig {
  providerId: string;
  providerLabel: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  allowedModels: string[] | null; // null = sin restricción
  systemPrompt?: string;
  clientToken?: string;
  maxPromptLength: number;
  dailyLimit: number;
  updateUrl?: string; // URL del updater (GET /download, admite {platform})
}

function str(env: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = env[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function int(env: Record<string, unknown>, name: string, fallback: number): number {
  const v = parseInt(String(env[name] ?? ''), 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Toda la configuración sale de variables de entorno (.env del servidor local).
export function resolveConfig(env: Record<string, unknown>): ResolvedConfig {
  const { provider, aliasBaseUrl } = getProvider(str(env, 'AI_PROVIDER'));

  const apiKey =
    str(env, ...provider.keyEnvVars) ||
    (typeof env.AI_API_KEY === 'string' ? env.AI_API_KEY.trim() : '') ||
    '';

  const baseUrl = str(env, 'AI_BASE_URL') || aliasBaseUrl || provider.defaultBaseUrl;

  const allowedRaw = str(env, 'AI_ALLOWED_MODELS');
  const allowedModels = allowedRaw
    ? allowedRaw
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    : null;

  return {
    providerId: provider.id,
    providerLabel: provider.label,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    defaultModel: str(env, 'AI_DEFAULT_MODEL') || provider.defaultModel,
    allowedModels,
    systemPrompt: str(env, 'SYSTEM_PROMPT'),
    clientToken: str(env, 'CLIENT_TOKEN'),
    maxPromptLength: int(env, 'MAX_PROMPT_LENGTH', 4000),
    dailyLimit: int(env, 'DAILY_LIMIT', 100),
    updateUrl: str(env, 'UPDATE_URL'),
  };
}
