import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { toWebRequest } from './server';

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
