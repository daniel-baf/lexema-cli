import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openaiProvider } from './openai';
import { ProviderError } from './types';

const ctx = { apiKey: 'sk-test', baseUrl: 'https://api.example.com' };

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

describe('openaiProvider.complete', () => {
  it('devuelve el contenido del mensaje en éxito', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: 'hola' } }] })
    );
    const reply = await openaiProvider.complete('hi', 'gpt-4', ctx);
    expect(reply).toBe('hola');
  });

  it('cae al error.message si no hay contenido', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { error: { message: 'oops' } }));
    const reply = await openaiProvider.complete('hi', 'gpt-4', ctx);
    expect(reply).toBe('oops');
  });

  it('cae al mensaje por defecto si no hay contenido ni error', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}));
    const reply = await openaiProvider.complete('hi', 'gpt-4', ctx);
    expect(reply).toBe('Sin respuesta del modelo.');
  });

  it('lanza ProviderError 429 en cuota agotada', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('rate limited', { status: 429 }));
    await expect(openaiProvider.complete('hi', 'gpt-4', ctx)).rejects.toMatchObject({
      status: 429,
    });
    await expect(openaiProvider.complete('hi', 'gpt-4', ctx)).rejects.toBeInstanceOf(
      ProviderError
    );
  });

  it('lanza ProviderError 502 en 401/403', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(openaiProvider.complete('hi', 'gpt-4', ctx)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('rechazó la clave'),
    });
  });

  it('lanza ProviderError 502 en 404 mencionando el modelo', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(openaiProvider.complete('hi', 'gpt-x', ctx)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('gpt-x'),
    });
  });

  it('lanza ProviderError genérico en otros status', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(openaiProvider.complete('hi', 'gpt-4', ctx)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('envía Authorization Bearer y omite system role si no hay systemPrompt', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] })
    );
    await openaiProvider.complete('hi', 'gpt-4', ctx);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init?.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('incluye el mensaje system cuando hay systemPrompt', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] })
    );
    await openaiProvider.complete('hi', 'gpt-4', { ...ctx, systemPrompt: 'sé breve' });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sé breve' });
  });
});
