// Servidor HTTP sobre Node puro (proxy hacia el proveedor de IA).
// Lee la configuración de un archivo .env (o .dev.vars).
//
//   npm run dev            # http://localhost:8787
//   PORT=3000 npm run dev
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { handleRequest, KVLike, UpdateFile } from './handler';
import { resolveConfig } from './config';

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// KV en memoria para el rate limiting local (no sobrevive reinicios,
// suficiente para un servidor de pruebas).
class MemoryKV implements KVLike {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null,
    });
  }
}

// realIp viene del socket TCP, no de un header: no hay Cloudflare por
// delante, así que es la única fuente de IP que un cliente no puede
// falsear. Se inyecta como header interno DESPUÉS de copiar los headers
// originales, pisando cualquier x-lexema-real-ip que el cliente mande.
export async function toWebRequest(req: http.IncomingMessage, realIp: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const host = (req.headers.host as string) || 'localhost';
  const headers = { ...(req.headers as Record<string, string>), 'x-lexema-real-ip': realIp };
  return new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') ? undefined : body,
  });
}

// Log simple por request: sirve para ver en la terminal quién se conecta
// mientras corre "npm run dev". Nunca incluye Authorization ni el body
// (podrían traer el token o el prompt del usuario).
function logRequest(method: string, urlPath: string, status: number, ms: number, ip: string): void {
  console.log(`[${new Date().toISOString()}] ${method} ${urlPath} ${status} ${ms}ms ip=${ip}`);
}

// Streamea la respuesta en vez de bufferizarla entera: crítico para
// /download y /install/binary (binarios grandes), y funciona igual para
// JSON porque su .body también es un stream de un solo chunk.
export async function sendWebResponse(res: http.ServerResponse, webRes: Response): Promise<void> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(webRes.status, headers);
  if (webRes.body) {
    await pipeline(Readable.fromWeb(webRes.body as import('node:stream/web').ReadableStream), res);
  } else {
    res.end();
  }
}

// Cache de hash SHA-256 por archivo, a nivel de módulo (vive mientras el
// proceso del server esté arriba). Evita releer y rehashear el binario en
// cada request a /install: solo recalcula si mtimeMs cambió (nuevo deploy).
const hashCache = new Map<string, { mtimeMs: number; hash: string }>();

export async function getCachedHash(file: string): Promise<string> {
  const stat = await fs.promises.stat(file);
  const cached = hashCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.hash;
  const bytes = await fs.promises.readFile(file);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  hashCache.set(file, { mtimeMs: stat.mtimeMs, hash });
  return hash;
}

function main(): void {
  // Los archivos .env / .dev.vars se buscan en el directorio actual
  // (npm run dev:node corre desde worker/). ENV_FILE permite apuntar a otro.
  if (process.env.ENV_FILE) {
    loadEnvFile(process.env.ENV_FILE);
  } else {
    loadEnvFile(path.resolve(process.cwd(), '.env')); // .env tiene prioridad
    loadEnvFile(path.resolve(process.cwd(), '.dev.vars'));
  }

  const cfg = resolveConfig(process.env);
  const port = parseInt(process.env.PORT || '8787', 10);
  const kv = new MemoryKV();

  // Updater por SO: la CLI manda ?platform= (process.platform) y el
  // servidor elige el archivo. ESTE mapa es el único lugar que hay que
  // tocar para cambiar qué se distribuye en cada plataforma. UPDATE_FILE
  // en el .env tiene prioridad sobre el mapa; un SO sin entrada (p.ej.
  // darwin) o con el archivo ausente cae al fallback.
  const UPDATER_FILES: Record<string, string> = {
    linux: 'public/update.elf',
    win32: 'public/update.exe',
  };
  const FALLBACK_UPDATER = 'public/test.sh';

  const resolveUpdateFile = (platform: string): string | null => {
    const override = process.env.UPDATE_FILE;
    if (override) return path.resolve(process.cwd(), override);
    for (const rel of [UPDATER_FILES[platform], FALLBACK_UPDATER]) {
      if (!rel) continue;
      const abs = path.resolve(process.cwd(), rel);
      if (fs.existsSync(abs)) return abs;
    }
    return null;
  };

  const makeUpdateFileSource = (platform: string) => async (): Promise<UpdateFile | null> => {
    const file = resolveUpdateFile(platform);
    if (!file) return null; // sin archivo: /download responde según cfg.updateUrl o 404
    try {
      const bytes = await fs.promises.readFile(file);
      return { bytes: new Uint8Array(bytes), filename: path.basename(file) };
    } catch {
      return null;
    }
  };

  // Binarios de la CLI servidos por GET /install (Linux, autodetección de
  // arquitectura), GET /install.ps1 (Windows) y GET /install/binary?os=...
  // INSTALL_FILE en el .env tiene prioridad y fuerza UN único archivo para
  // todos los OS (por si subís un ejecutable a otra ruta); el default es lo
  // que genera "make compile" en cli/dist-bin, resuelto desde worker/ o
  // desde la raíz del repo según dónde se haya iniciado el servidor.
  const CLI_BIN_DIRS = [
    path.resolve(process.cwd(), '..', 'cli', 'dist-bin'),
    path.resolve(process.cwd(), 'cli', 'dist-bin'),
  ];
  const INSTALL_FILES: Record<string, string> = {
    'linux-x64': 'lexema-linux-x64',
    'linux-arm64': 'lexema-linux-arm64',
    'windows-x64': 'lexema-windows-x64.exe',
  };
  // Nombre con el que llega el archivo al cliente (Content-Disposition).
  const INSTALL_OUT_NAMES: Record<string, string> = {
    'linux-x64': 'lexema',
    'linux-arm64': 'lexema',
    'windows-x64': 'lexema.exe',
  };

  const resolveCliBinary = (os: string): string | null => {
    const override = process.env.INSTALL_FILE;
    if (override) return path.resolve(process.cwd(), override);
    const rel = INSTALL_FILES[os];
    if (!rel) return null;
    for (const dir of CLI_BIN_DIRS) {
      const candidate = path.join(dir, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };

  const makeInstallBinarySource = () => async (os: string): Promise<UpdateFile | null> => {
    const file = resolveCliBinary(os);
    if (!file) return null; // sin binario para ese OS: /install responde 404
    try {
      const bytes = await fs.promises.readFile(file);
      return { bytes: new Uint8Array(bytes), filename: INSTALL_OUT_NAMES[os] || 'lexema' };
    } catch {
      return null;
    }
  };

  const makeInstallHashSource = () => async (os: string): Promise<string | null> => {
    const file = resolveCliBinary(os);
    if (!file) return null;
    try {
      return await getCachedHash(file);
    } catch {
      return null;
    }
  };

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    const realIp = req.socket.remoteAddress || 'local';
    const method = req.method || 'GET';
    const urlPath = req.url || '/';
    try {
      const webReq = await toWebRequest(req, realIp);
      const platform = new URL(webReq.url).searchParams.get('platform') || '';
      const webRes = await handleRequest(
        webReq,
        cfg,
        kv,
        makeUpdateFileSource(platform),
        makeInstallBinarySource(),
        makeInstallHashSource()
      );
      await sendWebResponse(res, webRes);
      logRequest(method, urlPath, webRes.status, Date.now() - start, realIp);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Error procesando la petición' }));
      logRequest(method, urlPath, 500, Date.now() - start, realIp);
    }
  });

  server.listen(port, () => {
    console.log(`Lexema dev server  ->  http://localhost:${port}`);
    console.log(`Proveedor: ${cfg.providerLabel}`);
    console.log(`Modelo por defecto: ${cfg.defaultModel}`);
    console.log(`API key: ${cfg.apiKey ? 'configurada' : pcRed('FALTA (revisa tu .env)')}`);
    console.log(`Auth (CLIENT_TOKEN): ${cfg.clientToken ? 'activada' : 'desactivada'}`);
    console.log(
      `Endpoints: POST /  ·  GET /models  ·  GET /health  ·  GET /download  ·  GET /install  ·  GET /uninstall  ·  GET /uninstall.ps1`
    );
    console.log(
      `Updater: linux -> ${UPDATER_FILES.linux}  ·  win32 -> ${UPDATER_FILES.win32}  ·  fallback -> ${FALLBACK_UPDATER}`
    );
    for (const os of Object.keys(INSTALL_FILES)) {
      const file = resolveCliBinary(os);
      console.log(
        `Instalador CLI (${os}): ${
          file ? file : 'falta (corre "make compile")'
        }`
      );
    }
  });
}

function pcRed(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}

main();
