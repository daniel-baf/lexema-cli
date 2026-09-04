import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapHttpErrorToProviderError, ProviderError } from './types';

const labels = {
  logPrefix: 'Test error',
  rateLimited: 'rate limited msg',
  authRejected: 'auth rejected msg',
  modelNotFound: (m: string) => `model not found: ${m}`,
};

afterEach(() => {
  vi.restoreAllMocks();
});

// Documenta el contrato ACTUAL de mapHttpErrorToProviderError: 401/403 caen
// a 502 (decisión conservadora, no se cambia en esta unidad).
describe('mapHttpErrorToProviderError', () => {
  it('401 -> ProviderError status 502 con mensaje authRejected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = new Response('nope', { status: 401 });
    const err = await mapHttpErrorToProviderError(res, 'gpt-4', labels);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(502);
    expect(err.message).toBe('auth rejected msg');
  });

  it('403 -> ProviderError status 502 con mensaje authRejected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = new Response('forbidden', { status: 403 });
    const err = await mapHttpErrorToProviderError(res, 'gpt-4', labels);
    expect(err.status).toBe(502);
    expect(err.message).toBe('auth rejected msg');
  });

  it('404 -> ProviderError status 502 con mensaje modelNotFound', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = new Response('not found', { status: 404 });
    const err = await mapHttpErrorToProviderError(res, 'gpt-x', labels);
    expect(err.status).toBe(502);
    expect(err.message).toBe('model not found: gpt-x');
  });

  it('429 -> ProviderError status 429 con mensaje rateLimited', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = new Response('rate limited', { status: 429 });
    const err = await mapHttpErrorToProviderError(res, 'gpt-4', labels);
    expect(err.status).toBe(429);
    expect(err.message).toBe('rate limited msg');
  });

  it('500 -> ProviderError status 502 con mensaje genérico', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = new Response('boom', { status: 500 });
    const err = await mapHttpErrorToProviderError(res, 'gpt-4', labels);
    expect(err.status).toBe(502);
    expect(err.message).toBe('Error del proveedor de IA.');
  });
});
