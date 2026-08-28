import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geminiProvider } from './gemini';
import { ProviderError } from './types';

const ctx = { apiKey: 'gk-test', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geminiProvider.complete', () => {
  it('devuelve el texto de la primera candidata en éxito', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'hola' }] } }] })
    );
    const reply = await geminiProvider.complete('hi', 'gemini-3.5-flash-lite', ctx);
    expect(reply).toBe('hola');
  });

  it('cae al mensaje por defecto si no hay candidatas', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}));
    const reply = await geminiProvider.complete('hi', 'gemini-3.5-flash-lite', ctx);
    expect(reply).toBe('Sin respuesta del modelo.');
  });

  it('lanza ProviderError 429 en cuota agotada', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('rate limited', { status: 429 }));
    await expect(
      geminiProvider.complete('hi', 'gemini-3.5-flash-lite', ctx)
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      geminiProvider.complete('hi', 'gemini-3.5-flash-lite', ctx)
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('lanza ProviderError 502 en 401/403 mencionando GEMINI_API_KEY', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 403 }));
    await expect(
      geminiProvider.complete('hi', 'gemini-3.5-flash-lite', ctx)
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('GEMINI_API_KEY'),
    });
  });

  it('lanza ProviderError 502 en 404 mencionando el modelo', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(geminiProvider.complete('hi', 'gemini-x', ctx)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('gemini-x'),
    });
  });

  it('lanza ProviderError genérico en otros status', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      geminiProvider.complete('hi', 'gemini-3.5-flash-lite', ctx)
    ).rejects.toMatchObject({ status: 502 });
  });

  it('envía la API key en x-goog-api-key y omite systemInstruction si no hay systemPrompt', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
    );
    await geminiProvider.complete('hi', 'gemini-3.5-flash-lite', ctx);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('gk-test');
    const body = JSON.parse(init?.body as string);
    expect(body.systemInstruction).toBeUndefined();
  });

  it('incluye systemInstruction cuando hay systemPrompt', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
    );
    await geminiProvider.complete('hi', 'gemini-3.5-flash-lite', {
      ...ctx,
      systemPrompt: 'sé breve',
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sé breve' }] });
  });
});
