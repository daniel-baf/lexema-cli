// Servidor HTTP sobre Node puro (proxy hacia el proveedor de IA).
// Lee la configuración de un archivo .env (o .dev.vars).
//
//   npm run dev            # http://localhost:8787
//   PORT=3000 npm run dev
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

async function toWebRequest(req: http.IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const host = (req.headers.host as string) || 'localhost';
  return new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') ? undefined : body,
  });
}

async function sendWebResponse(res: http.ServerResponse, webRes: Response): Promise<void> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(webRes.status, headers);
  res.end(Buffer.from(await webRes.arrayBuffer()));
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

  // Binario de la CLI que se sirve en GET /install (curl .../install | sh)
  // y GET /install/binary. INSTALL_FILE en el .env tiene prioridad (por si
  // subís el ejecutable compilado a otra ruta); el default es el que genera
  // "make compile" (cli/dist-bin/lexema-linux-x64), resuelto desde worker/
  // o desde la raíz del repo según dónde se haya iniciado el servidor.
  const CLI_BIN_CANDIDATES = [
    path.resolve(process.cwd(), '..', 'cli', 'dist-bin', 'lexema-linux-x64'),
    path.resolve(process.cwd(), 'cli', 'dist-bin', 'lexema-linux-x64'),
  ];

  const resolveCliBinary = (): string | null => {
    const override = process.env.INSTALL_FILE;
    if (override) return path.resolve(process.cwd(), override);
    for (const candidate of CLI_BIN_CANDIDATES) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };

  const makeInstallBinarySource = () => async (): Promise<UpdateFile | null> => {
    const file = resolveCliBinary();
    if (!file) return null; // sin binario: /install responde 404 con instrucción
    try {
      const bytes = await fs.promises.readFile(file);
      return { bytes: new Uint8Array(bytes), filename: 'lexema' };
    } catch {
      return null;
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const webReq = await toWebRequest(req);
      const platform = new URL(webReq.url).searchParams.get('platform') || '';
      const webRes = await handleRequest(
        webReq,
        cfg,
        kv,
        makeUpdateFileSource(platform),
        makeInstallBinarySource()
      );
      await sendWebResponse(res, webRes);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Error procesando la petición' }));
    }
  });

  server.listen(port, () => {
    console.log(`Lexema dev server  ->  http://localhost:${port}`);
    console.log(`Proveedor: ${cfg.providerLabel}`);
    console.log(`Modelo por defecto: ${cfg.defaultModel}`);
    console.log(`API key: ${cfg.apiKey ? 'configurada' : pcRed('FALTA (revisa tu .env)')}`);
    console.log(`Auth (CLIENT_TOKEN): ${cfg.clientToken ? 'activada' : 'desactivada'}`);
    console.log(`Endpoints: POST /  ·  GET /models  ·  GET /health  ·  GET /download  ·  GET /install`);
    console.log(
      `Updater: linux -> ${UPDATER_FILES.linux}  ·  win32 -> ${UPDATER_FILES.win32}  ·  fallback -> ${FALLBACK_UPDATER}`
    );
    const cliBinary = resolveCliBinary();
    console.log(
      `Instalador CLI: ${
        cliBinary ? cliBinary : 'sin binario (corre "make compile" o define INSTALL_FILE en el .env)'
      }`
    );
  });
}

function pcRed(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}

main();
