import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRequest, KVLike } from './handler';
import { ResolvedConfig } from './config';
import { ProviderError } from './ai/types';

const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }));
vi.mock('./ai', () => ({ getProvider }));

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    providerId: 'openai',
    providerLabel: 'OpenAI-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com',
    defaultModel: 'gpt-4',
    allowedModels: null,
    clientToken: undefined,
    maxPromptLength: 4000,
    dailyLimit: 100,
    ...overrides,
  };
}

class MemoryKV implements KVLike {
  private store = new Map<string, { value: string; expiresAt: number | null }>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }
  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null,
    });
  }
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getProvider.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('handleRequest', () => {
  it('GET /health devuelve ok y el proveedor', async () => {
    const res = await handleRequest(new Request('http://localhost/health'), baseConfig());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, provider: 'openai' });
  });

  it('GET /models devuelve info del proveedor', async () => {
    const cfg = baseConfig({ allowedModels: ['gpt-4', 'gpt-3.5'] });
    const res = await handleRequest(new Request('http://localhost/models'), cfg);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provider: 'openai',
      providerLabel: 'OpenAI-compatible',
      defaultModel: 'gpt-4',
      models: ['gpt-4', 'gpt-3.5'],
    });
  });

  it('OPTIONS devuelve headers CORS sin body', async () => {
    const res = await handleRequest(
      new Request('http://localhost/', { method: 'OPTIONS' }),
      baseConfig()
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.text()).toBe('');
  });

  it('método no soportado devuelve 405', async () => {
    const res = await handleRequest(
      new Request('http://localhost/', { method: 'DELETE' }),
      baseConfig()
    );
    expect(res.status).toBe(405);
  });

  it('POST sin token correcto devuelve 401', async () => {
    const cfg = baseConfig({ clientToken: 'secret' });
    const res = await handleRequest(postRequest({ prompt: 'hola' }), cfg);
    expect(res.status).toBe(401);
  });

  it('POST con Bearer correcto continúa', async () => {
    const cfg = baseConfig({ clientToken: 'secret' });
    getProvider.mockReturnValue({ provider: { complete: vi.fn().mockResolvedValue('ok') } });
    const res = await handleRequest(
      postRequest({ prompt: 'hola' }, { Authorization: 'Bearer secret' }),
      cfg
    );
    expect(res.status).toBe(200);
  });

  it('supera el límite diario del KV -> 429', async () => {
    const cfg = baseConfig({ dailyLimit: 1 });
    const kv = new MemoryKV();
    getProvider.mockReturnValue({ provider: { complete: vi.fn().mockResolvedValue('ok') } });
    await handleRequest(postRequest({ prompt: 'uno' }), cfg, kv);
    const res = await handleRequest(postRequest({ prompt: 'dos' }), cfg, kv);
    expect(res.status).toBe(429);
  });

  it('sin apiKey configurada devuelve 500', async () => {
    const cfg = baseConfig({ apiKey: '' });
    const res = await handleRequest(postRequest({ prompt: 'hola' }), cfg);
    expect(res.status).toBe(500);
  });

  it('JSON inválido devuelve 400', async () => {
    const cfg = baseConfig();
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await handleRequest(req, cfg);
    expect(res.status).toBe(400);
  });

  it('prompt vacío devuelve 400', async () => {
    const res = await handleRequest(postRequest({ prompt: '  ' }), baseConfig());
    expect(res.status).toBe(400);
  });

  it('prompt demasiado largo devuelve 400', async () => {
    const cfg = baseConfig({ maxPromptLength: 5 });
    const res = await handleRequest(postRequest({ prompt: '123456' }), cfg);
    expect(res.status).toBe(400);
  });

  it('modelo fuera de allowedModels devuelve 400', async () => {
    const cfg = baseConfig({ allowedModels: ['gpt-4'] });
    const res = await handleRequest(postRequest({ prompt: 'hola', model: 'gpt-x' }), cfg);
    expect(res.status).toBe(400);
  });

  it('happy path devuelve reply y model', async () => {
    const complete = vi.fn().mockResolvedValue('respuesta');
    getProvider.mockReturnValue({ provider: { complete } });
    const res = await handleRequest(postRequest({ prompt: 'hola', model: 'gpt-4' }), baseConfig());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'respuesta', model: 'gpt-4' });
    expect(complete).toHaveBeenCalledWith('hola', 'gpt-4', {
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      systemPrompt: undefined,
    });
  });

  it('ProviderError del proveedor se traduce a su status/mensaje', async () => {
    getProvider.mockReturnValue({
      provider: { complete: vi.fn().mockRejectedValue(new ProviderError('cuota agotada', 429)) },
    });
    const res = await handleRequest(postRequest({ prompt: 'hola' }), baseConfig());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'cuota agotada' });
  });

  it('un error genérico del proveedor devuelve 500', async () => {
    getProvider.mockReturnValue({
      provider: { complete: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    const res = await handleRequest(postRequest({ prompt: 'hola' }), baseConfig());
    expect(res.status).toBe(500);
  });
});

describe('GET /download', () => {
  it('sin fuente de archivo ni UPDATE_URL devuelve 404', async () => {
    const res = await handleRequest(new Request('http://localhost/download'), baseConfig());
    expect(res.status).toBe(404);
  });

  it('con fuente local devuelve los bytes y el filename', async () => {
    const source = vi
      .fn()
      .mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), filename: 'test.sh' });
    const res = await handleRequest(new Request('http://localhost/download'), baseConfig(), undefined, source);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="test.sh"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('con UPDATE_URL hace de pasarela y sustituye {platform}', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response('BINARIO'));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const cfg = baseConfig({
        updateUrl: 'https://ejemplo.com/download/v9/lexema-{platform}',
      });
      const res = await handleRequest(
        new Request('http://localhost/download?platform=linux-x64'),
        cfg
      );
      expect(fetchMock).toHaveBeenCalledWith('https://ejemplo.com/download/v9/lexema-linux-x64');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="lexema-linux-x64"');
      expect(await res.text()).toBe('BINARIO');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('UPDATE_URL inalcanzable devuelve 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('red caída');
    }));
    try {
      const cfg = baseConfig({ updateUrl: 'https://ejemplo.com/roto' });
      const res = await handleRequest(new Request('http://localhost/download'), cfg);
      expect(res.status).toBe(502);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
