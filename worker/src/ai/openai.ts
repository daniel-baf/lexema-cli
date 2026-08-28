import { AIProvider, ProviderContext, ProviderError, readErrorBody } from './types';

interface ChatCompletionsResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

async function complete(prompt: string, model: string, ctx: ProviderContext): Promise<string> {
  const messages: { role: string; content: string }[] = [];
  if (ctx.systemPrompt) messages.push({ role: 'system', content: ctx.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(`${ctx.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const errText = await readErrorBody(res);
    console.error('Provider error:', res.status, errText);
    if (res.status === 429) {
      throw new ProviderError(
        'Se alcanzó la cuota del modelo. Intenta en unos minutos o prueba con otro modelo.',
        429
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        'El proveedor rechazó la clave de API (revisa la variable de API key en tu .env).',
        502
      );
    }
    if (res.status === 404) {
      throw new ProviderError(
        `El modelo "${model}" no existe en este proveedor. Consulta su catálogo de modelos.`,
        502
      );
    }
    throw new ProviderError('Error del proveedor de IA.', 502);
  }

  const data = (await res.json()) as ChatCompletionsResponse;
  return data.choices?.[0]?.message?.content || data.error?.message || 'Sin respuesta del modelo.';
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
