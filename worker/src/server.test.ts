import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { toWebRequest, sendWebResponse, getCachedHash } from './server';
import { handleRequest } from './handler';
import { resolveConfig } from './config';

// Mock mínimo de http.IncomingMessage: solo lo que toWebRequest usa
// (headers, method, url, y el propio stream para el body).
function fakeIncomingMessage(opts: {
  headers: Record<string, string>;
  method?: string;
  url?: string;
}): IncomingMessage {
  const stream = Readable.from([]) as unknown as IncomingMessage;
  stream.headers = opts.headers;
  stream.method = opts.method || 'GET';
  stream.url = opts.url || '/';
  return stream;
}

describe('toWebRequest', () => {
  it('setea x-lexema-real-ip con la IP real del socket, pisando cualquier valor del cliente', async () => {
    const req = fakeIncomingMessage({
      headers: { host: 'localhost:8787', 'x-lexema-real-ip': '6.6.6.6' }, // spoof del cliente
    });
    const webReq = await toWebRequest(req, '127.0.0.1'); // IP real, la del socket
    expect(webReq.headers.get('x-lexema-real-ip')).toBe('127.0.0.1');
  });

  it('sin spoof previo, igual queda seteada la IP real', async () => {
    const req = fakeIncomingMessage({ headers: { host: 'localhost:8787' } });
    const webReq = await toWebRequest(req, '10.0.0.5');
    expect(webReq.headers.get('x-lexema-real-ip')).toBe('10.0.0.5');
  });
});

describe('sendWebResponse (streaming real, server levantado en puerto efímero)', () => {
  it('el tamaño del body recibido coincide con el tamaño esperado (respuesta grande vía /models)', async () => {
    // AI_ALLOWED_MODELS grande para forzar un body de JSON de tamaño conocido.
    const bigModels = Array.from({ length: 5000 }, (_, i) => `model-${i}`);
    const cfg = resolveConfig({ AI_ALLOWED_MODELS: bigModels.join(',') });
    const expectedBody = JSON.stringify({
      provider: cfg.providerId,
      providerLabel: cfg.providerLabel,
      defaultModel: cfg.defaultModel,
      models: cfg.allowedModels,
    });

    const server = http.createServer(async (req, res) => {
      const webReq = await toWebRequest(req, '127.0.0.1');
      const webRes = await handleRequest(webReq, cfg);
      await sendWebResponse(res, webRes);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/models`);
      const received = await res.text();
      expect(received.length).toBe(expectedBody.length);
      expect(received).toBe(expectedBody);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('getCachedHash', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexema-hash-test-'));
  const file = path.join(tmpDir, 'binary.bin');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('con el mismo mtimeMs, calcula el hash una sola vez', async () => {
    fs.writeFileSync(file, 'contenido-v1');
    const spy = vi.spyOn(crypto, 'createHash');

    const first = await getCachedHash(file);
    const second = await getCachedHash(file);

    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('si mtimeMs cambia (nuevo contenido), recalcula el hash', async () => {
    fs.writeFileSync(file, 'contenido-v2');
    const before = await getCachedHash(file);

    // Simula un mtime distinto: escribe contenido nuevo y fuerza el mtime
    // (algunos filesystems truncan a resolución de segundos).
    fs.writeFileSync(file, 'contenido-v3-mas-largo');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);

    const spy = vi.spyOn(crypto, 'createHash');
    const after = await getCachedHash(file);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(after).not.toBe(before);
  });
});
