import { AIProvider, ProviderContext, ProviderError, readErrorBody } from './types';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

async function complete(prompt: string, model: string, ctx: ProviderContext): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  if (ctx.systemPrompt) {
    body.systemInstruction = { parts: [{ text: ctx.systemPrompt }] };
  }

  const res = await fetch(`${ctx.baseUrl}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': ctx.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await readErrorBody(res);
    console.error('Gemini error:', res.status, errText);
    if (res.status === 429) {
      throw new ProviderError(
        'Se alcanzó la cuota gratuita del modelo. Intenta en unos minutos o prueba con otro modelo.',
        429
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('El proveedor rechazó la clave de API (revisa GEMINI_API_KEY).', 502);
    }
    if (res.status === 404) {
      throw new ProviderError(`El modelo "${model}" no existe en Gemini.`, 502);
    }
    throw new ProviderError('Error del proveedor de IA.', 502);
  }

  const data = (await res.json()) as GeminiResponse;
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sin respuesta del modelo.';
}

export const geminiProvider: AIProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  keyEnvVars: ['GEMINI_API_KEY', 'AI_API_KEY', 'GOOGLE_API_KEY'],
  defaultModel: 'gemini-3.5-flash-lite',
  complete,
};
