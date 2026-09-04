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
  aiTimeoutMs: number; // timeout del fetch al proveedor de IA
}

function str(env: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = env[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

// Solo enteros puros (con signo opcional): parseInt trunca strings mal
// formados en silencio (parseInt('4000ish', 10) === 4000), así que un valor
// que no matchea cae directo al fallback en vez de "parsear a medias".
function int(env: Record<string, unknown>, name: string, fallback: number): number {
  const raw = String(env[name] ?? '').trim();
  if (!/^-?\d+$/.test(raw)) return fallback;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Toda la configuración sale de variables de entorno (.env del servidor local).
export function resolveConfig(env: Record<string, unknown>): ResolvedConfig {
  const { provider, aliasBaseUrl } = getProvider(str(env, 'AI_PROVIDER'));

  // provider.keyEnvVars ya incluye AI_API_KEY como última opción genérica,
  // así que no hace falta un fallback manual aparte.
  const apiKey = str(env, ...provider.keyEnvVars) || '';

  const baseUrl = str(env, 'AI_BASE_URL') || aliasBaseUrl || provider.defaultBaseUrl;
  try {
    new URL(baseUrl);
  } catch {
    // Fail-fast al arrancar el server: mejor un error claro acá que un
    // fetch roto en cada request al proveedor de IA.
    throw new Error(`AI_BASE_URL inválida: "${baseUrl}"`);
  }

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
    aiTimeoutMs: int(env, 'AI_TIMEOUT_MS', 30000),
  };
}
