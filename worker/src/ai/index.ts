import { AIProvider } from './types';
import { geminiProvider } from './gemini';
import { openaiProvider } from './openai';

export { ProviderError } from './types';
export type { AIProvider, ProviderContext } from './types';

const PROVIDERS: Record<string, AIProvider> = {
  gemini: geminiProvider,
  openai: openaiProvider,
};

// Alias aceptados en AI_PROVIDER. "openrouter" usa el proveedor openai
// (compatibilidad OpenAI) pero con la base URL de OpenRouter por defecto.
const ALIASES: Record<string, { id: string; baseUrl?: string }> = {
  openrouter: { id: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  openai: { id: 'openai', baseUrl: 'https://api.openai.com/v1' },
  groq: { id: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
};

// Sin AI_PROVIDER explícito: gemini si hay GEMINI_API_KEY/GOOGLE_API_KEY,
// si no openai (compatible con OpenRouter/Groq/OpenAI vía AI_BASE_URL).
function autodetectProvider(env?: Record<string, unknown>): AIProvider {
  const has = (key: string) => typeof env?.[key] === 'string' && (env[key] as string).trim() !== '';
  if (has('GEMINI_API_KEY') || has('GOOGLE_API_KEY')) return geminiProvider;
  return openaiProvider;
}

export function getProvider(
  name?: string,
  env?: Record<string, unknown>
): { provider: AIProvider; aliasBaseUrl?: string } {
  const raw = (name || '').trim().toLowerCase();
  if (!raw) return { provider: autodetectProvider(env) };
  const alias = ALIASES[raw];
  if (alias) {
    const provider = PROVIDERS[alias.id];
    return { provider, aliasBaseUrl: alias.baseUrl || provider.defaultBaseUrl };
  }
  const provider = PROVIDERS[raw];
  if (provider) return { provider };
  throw new Error(
    `Proveedor desconocido: "${raw}". Valores soportados: gemini, openai, openrouter, groq.`
  );
}

export function listProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}
