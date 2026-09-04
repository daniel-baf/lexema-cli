import { AIProvider, ProviderContext, ProviderError, mapHttpErrorToProviderError } from './types';

interface ChatCompletionsResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

async function complete(prompt: string, model: string, ctx: ProviderContext): Promise<string> {
  const messages: { role: string; content: string }[] = [];
  if (ctx.systemPrompt) messages.push({ role: 'system', content: ctx.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${ctx.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ProviderError('El proveedor de IA no respondió a tiempo.', 504);
    }
    // Falla de red/DNS antes de llegar al proveedor: no dejar que la
    // excepción cruda se propague al handler.
    throw new ProviderError('No se pudo contactar al proveedor de IA.', 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw await mapHttpErrorToProviderError(res, model, {
      logPrefix: 'Provider error',
      rateLimited: 'Se alcanzó la cuota del modelo. Intenta en unos minutos o prueba con otro modelo.',
      authRejected: 'El proveedor rechazó la clave de API (revisa la variable de API key en tu .env).',
      modelNotFound: (m) => `El modelo "${m}" no existe en este proveedor. Consulta su catálogo de modelos.`,
    });
  }

  let data: ChatCompletionsResponse;
  try {
    data = (await res.json()) as ChatCompletionsResponse;
  } catch {
    throw new ProviderError('El proveedor devolvió una respuesta inválida.', 502);
  }

  // '' es una respuesta vacía legítima del modelo, distinta de "no vino nada".
  const content = data.choices?.[0]?.message?.content;
  if (content !== undefined) return content;
  return data.error?.message || 'Sin respuesta del modelo.';
}

// Compatible con cualquier endpoint estilo OpenAI /chat/completions:
// OpenRouter, OpenAI, Groq, Together, Ollama (con API), etc.
export const openaiProvider: AIProvider = {
  id: 'openai',
  label: 'OpenAI-compatible (OpenRouter, OpenAI, Groq, ...)',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  keyEnvVars: ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'AI_API_KEY'],
  defaultModel: 'openrouter/auto',
  complete,
};
