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

describe('GET /install', () => {
  const binarySource = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'lexema' });

  it('sin binario en el servidor devuelve 404', async () => {
    const res = await handleRequest(new Request('http://localhost/install'), baseConfig());
    expect(res.status).toBe(404);
  });

  it('devuelve el script sh con la URL del servidor embebida', async () => {
    const res = await handleRequest(
      new Request('http://mi-vm:8787/install'),
      baseConfig(),
      undefined,
      undefined,
      binarySource
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('shellscript');
    const script = await res.text();
    expect(script).toContain('SERVER="http://mi-vm:8787"');
    expect(script).toContain('Linux-x86_64) OS="linux-x64"');
    expect(script).toContain('$SERVER/install/binary?os=$OS');
    expect(script).not.toContain('Authorization');
  });

  it('con CLIENT_TOKEN embebe el header en el script', async () => {
    const res = await handleRequest(
      new Request('http://localhost/install', {
        headers: { Authorization: 'Bearer secreto' },
      }),
      baseConfig({ clientToken: 'secreto' }),
      undefined,
      undefined,
      binarySource
    );
    const script = await res.text();
    expect(script).toContain('Authorization: Bearer secreto');
  });

  it('/install.sh es alias de /install', async () => {
    const res = await handleRequest(
      new Request('http://localhost/install.sh'),
      baseConfig(),
      undefined,
      undefined,
      binarySource
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /install.ps1', () => {
  const winSource = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'lexema.exe' });

  it('sin binario de Windows devuelve 404', async () => {
    const res = await handleRequest(new Request('http://localhost/install.ps1'), baseConfig());
    expect(res.status).toBe(404);
  });

  it('devuelve el script PowerShell apuntando al binario de Windows', async () => {
    const res = await handleRequest(
      new Request('http://mi-vm:8787/install.ps1'),
      baseConfig(),
      undefined,
      undefined,
      winSource
    );
    expect(res.status).toBe(200);
    expect(winSource).toHaveBeenCalledWith('windows-x64');
    const script = await res.text();
    expect(script).toContain('$Server = "http://mi-vm:8787"');
    expect(script).toContain('install/binary?os=windows-x64');
    expect(script).not.toContain('Authorization');
  });

  it('con CLIENT_TOKEN embebe el header en el script', async () => {
    const res = await handleRequest(
      new Request('http://localhost/install.ps1', {
        headers: { Authorization: 'Bearer secreto' },
      }),
      baseConfig({ clientToken: 'secreto' }),
      undefined,
      undefined,
      winSource
    );
    const script = await res.text();
    expect(script).toContain('$headers.Authorization = "Bearer secreto"');
  });
});

describe('GET /install/binary', () => {
  it('sirve el binario del OS pedido (default linux-x64)', async () => {
    const source = vi.fn().mockResolvedValue({ bytes: new Uint8Array([7, 8, 9]), filename: 'lexema' });
    const res = await handleRequest(
      new Request('http://localhost/install/binary'),
      baseConfig(),
      undefined,
      undefined,
      source
    );
    expect(res.status).toBe(200);
    expect(source).toHaveBeenCalledWith('linux-x64');
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="lexema"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
  });

  it('?os=windows-x64 pide el binario de Windows', async () => {
    const source = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'lexema.exe' });
    const res = await handleRequest(
      new Request('http://localhost/install/binary?os=windows-x64'),
      baseConfig(),
      undefined,
      undefined,
      source
    );
    expect(res.status).toBe(200);
    expect(source).toHaveBeenCalledWith('windows-x64');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="lexema.exe"');
  });

  it('?os= inválido cae al default (linux-x64)', async () => {
    const source = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'lexema' });
    await handleRequest(
      new Request('http://localhost/install/binary?os=templeos'),
      baseConfig(),
      undefined,
      undefined,
      source
    );
    expect(source).toHaveBeenCalledWith('linux-x64');
  });

  it('sin binario para el OS pedido devuelve 404', async () => {
    const source = vi.fn().mockResolvedValue(null);
    const res = await handleRequest(
      new Request('http://localhost/install/binary?os=windows-x64'),
      baseConfig(),
      undefined,
      undefined,
      source
    );
    expect(res.status).toBe(404);
  });

  it('sin binario compilado devuelve 404', async () => {
    const res = await handleRequest(
      new Request('http://localhost/install/binary'),
      baseConfig()
    );
    expect(res.status).toBe(404);
  });

  it('exige el CLIENT_TOKEN como el resto de endpoints', async () => {
    const res = await handleRequest(
      new Request('http://localhost/install/binary'),
      baseConfig({ clientToken: 'secreto' })
    );
    expect(res.status).toBe(401);
  });
});
