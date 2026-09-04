import { AIProvider } from './types';
import { openaiProvider } from './openai';

export { ProviderError } from './types';
export type { AIProvider, ProviderContext } from './types';

const PROVIDERS: Record<string, AIProvider> = {
  openai: openaiProvider,
};

// Alias aceptados en AI_PROVIDER. Todos usan el proveedor openai
// (compatibilidad OpenAI) pero con la base URL de cada uno por defecto.
const ALIASES: Record<string, { id: string; baseUrl?: string }> = {
  openrouter: { id: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  openai: { id: 'openai', baseUrl: 'https://api.openai.com/v1' },
  groq: { id: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
};

export function getProvider(name?: string): { provider: AIProvider; aliasBaseUrl?: string } {
  const raw = (name || '').trim().toLowerCase();
  if (!raw) return { provider: openaiProvider };
  const alias = ALIASES[raw];
  if (alias) {
    const provider = PROVIDERS[alias.id];
    return { provider, aliasBaseUrl: alias.baseUrl || provider.defaultBaseUrl };
  }
  const provider = PROVIDERS[raw];
  if (provider) return { provider };
  const supported = [...new Set([...listProviderIds(), ...Object.keys(ALIASES)])];
  throw new Error(`Proveedor desconocido: "${raw}". Valores soportados: ${supported.join(', ')}.`);
}

export function listProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}
