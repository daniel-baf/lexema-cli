import { handleRequest, KVLike } from './handler';
import { resolveConfig } from './config';

export interface Env {
  // Proveedor y modelo (ver .env.example para el catálogo completo)
  AI_PROVIDER?: string; // gemini | openai | openrouter | groq
  AI_API_KEY?: string; // clave genérica si no usas una específica del proveedor
  AI_BASE_URL?: string;
  AI_DEFAULT_MODEL?: string;
  AI_ALLOWED_MODELS?: string; // "m1,m2" — vacío = sin restricción
  SYSTEM_PROMPT?: string;

  // Claves específicas por proveedor (según el elegido)
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;

  // Control de acceso
  CLIENT_TOKEN?: string; // Bearer token que envía la CLI
  MAX_PROMPT_LENGTH?: string;
  DAILY_LIMIT?: string;

  // Actualizaciones de la CLI: el updater se sirve SIEMPRE en GET /download
  UPDATE_URL?: string; // URL del updater, admite {platform}

  RATE_LIMIT_KV?: KVNamespace; // opcional: activa límite diario por IP
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(
      request,
      resolveConfig(env as unknown as Record<string, unknown>),
      env.RATE_LIMIT_KV as unknown as KVLike | undefined
    );
  },
};
