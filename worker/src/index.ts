export interface Env {
  GEMINI_API_KEY: string;
  CLIENT_TOKEN?: string; // token compartido opcional para proteger el endpoint
  RATE_LIMIT_KV?: KVNamespace; // opcional: activa límite diario por IP
}

// Modelos permitidos. Revisa la lista vigente en https://ai.google.dev/gemini-api/docs/models
// (los proveedores retiran modelos de vez en cuando).
const ALLOWED_MODELS = new Set(['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite']);
const DEFAULT_MODEL = 'gemini-3.6-flash';
const DAILY_LIMIT = 100; // peticiones por IP por día cuando RATE_LIMIT_KV está enlazado
const MAX_PROMPT_LENGTH = 4000;

interface ChatRequestBody {
  prompt?: string;
  model?: string;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Método no permitido' }, 405);
    }

    // Autenticación simple por token compartido (opcional pero recomendado).
    // Nota: como la CLI es un binario público, un usuario avanzado podría extraer
    // este token del binario. No es un secreto perfecto, pero sí filtra tráfico
    // casual/bots que escanean la URL del Worker. Para protección real, combina
    // esto con el rate limiting por IP de abajo.
    if (env.CLIENT_TOKEN) {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.replace(/^Bearer\s+/i, '');
      if (token !== env.CLIENT_TOKEN) {
        return json({ error: 'No autorizado' }, 401);
      }
    }

    // Rate limiting opcional por IP (requiere el binding RATE_LIMIT_KV en wrangler.toml).
    if (env.RATE_LIMIT_KV) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const dayKey = `rl:${ip}:${new Date().toISOString().slice(0, 10)}`;
      const current = parseInt((await env.RATE_LIMIT_KV.get(dayKey)) || '0', 10);
      if (current >= DAILY_LIMIT) {
        return json({ error: 'Límite diario alcanzado, intenta mañana.' }, 429);
      }
      await env.RATE_LIMIT_KV.put(dayKey, String(current + 1), {
        expirationTtl: 60 * 60 * 24,
      });
    }

    let body: ChatRequestBody;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }

    const prompt = (body.prompt || '').trim();
    if (!prompt) {
      return json({ error: 'Falta el campo "prompt"' }, 400);
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return json(
        { error: `El prompt es demasiado largo (máx. ${MAX_PROMPT_LENGTH} caracteres)` },
        400
      );
    }

    const model = body.model && ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'El servidor no tiene configurada la clave de API' }, 500);
    }

    try {
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': env.GEMINI_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error('Gemini error:', aiResponse.status, errText);
        return json({ error: 'Error del proveedor de IA' }, 502);
      }

      const data = (await aiResponse.json()) as GeminiResponse;
      const reply =
        data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sin respuesta del modelo.';

      return json({ reply });
    } catch (err) {
      console.error(err);
      return json({ error: 'Error procesando la petición' }, 500);
    }
  },
};
