import axios from 'axios';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config';

export interface DownloadedUpdate {
  filename: string;
  bytes: Buffer;
}

// Nombre del archivo que distribuye el servidor. Es el ÚNICO lugar que
// hay que tocar para cambiar qué se distribuye: el worker elige el
// archivo según el SO (la CLI envía ?platform=) y lo anuncia en
// Content-Disposition, así que la CLI normalmente recibe el nombre real
// del server; esta constante es el fallback si el header no llega.
// Ejecución: .sh -> bash, resto (elf/exe nativo) -> directo.
export const UPDATER_FILENAME = 'update.elf';

const DOWNLOAD_TIMEOUT_MS = 30000;
const UPDATES_DIR = path.join(os.homedir(), '.lexema', 'updates');

// Cada cuánto se re-consulta el updater mientras la CLI está viva
// (sesión de chat). La VM del server puede cambiar en cualquier momento,
// así que el ciclo mantiene al cliente fresco sin reiniciar nada.
export const UPDATER_INTERVAL_MS = 30000;

// Extrae el filename de un header Content-Disposition y lo sanea
// (solo el nombre, sin ruta). Fallback si no hay header o no coincide.
export function parseFilename(disposition: string | undefined | null, fallback: string): string {
  if (!disposition) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1]?.trim();
  return (name && path.basename(name)) || fallback;
}

function workerBase(): string {
  return loadConfig().workerUrl.replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const config = loadConfig();
  return config.token ? { Authorization: `Bearer ${config.token}` } : {};
}

let downloadAbort: AbortController | null = null;

export async function downloadUpdateFile(): Promise<DownloadedUpdate> {
  downloadAbort = new AbortController();
  const res = await axios.get(`${workerBase()}/download`, {
    params: { platform: process.platform },
    headers: authHeaders(),
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT_MS,
    signal: downloadAbort.signal,
  });
  const disposition = res.headers?.['content-disposition'] as string | undefined;
  const filename = parseFilename(disposition, UPDATER_FILENAME);
  return { filename, bytes: Buffer.from(res.data) };
}

export function saveUpdateFile(bytes: Buffer, filename: string, dir = UPDATES_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(filename));
  fs.writeFileSync(target, bytes);
  fs.chmodSync(target, 0o755);
  return target;
}

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

// Tiempo máximo que puede correr el updater antes de ser terminado:
// un updater colgado nunca debe trabar la CLI por más que no responda.
export const EXEC_TIMEOUT_MS = 15000;

// Hijos vivos del updater: al cerrar la sesión se matan para que el
// proceso pueda salir ya (un nieto —p.ej. un sleep del script— hereda
// el pipe de stdout y mantiene vivo el event loop aunque el hijo muera).
const activeChildren = new Set<ChildProcess>();

function hardKill(child: ChildProcess): void {
  // Matar al GRUPO de procesos (pid negativo): bash muerto no basta
  // porque sus hijos heredan los pipes y bloquean el evento 'close'.
  try {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* el grupo ya murió */
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* ya murió */
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

// Detiene todo lo que el updater tenga en vuelo (descarga + ejecución):
// lo llama el cierre de sesión para salir limpio y rápido.
export function stopActiveUpdaters(): void {
  downloadAbort?.abort();
  for (const child of activeChildren) hardKill(child);
  activeChildren.clear();
}

// Ejecuta el updater SIN bloquear el event loop (spawn asíncrono en
// vez de spawnSync) y lo mata si excede el timeout. .sh -> bash,
// cualquier otra cosa (elf/exe nativo) -> directo.
export function executeUpdater(
  saved: string,
  timeoutMs = EXEC_TIMEOUT_MS
): Promise<ExecResult> {
  return new Promise((resolve) => {
    // detached: su propio grupo de procesos, para poder matarlos a todos.
    const detached = process.platform !== 'win32';
    const child = saved.endsWith('.sh')
      ? spawn('bash', [saved], { stdio: ['ignore', 'pipe', 'pipe'], detached })
      : spawn(saved, [], { stdio: ['ignore', 'pipe', 'pipe'], detached });
    activeChildren.add(child);

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      hardKill(child);
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      resolve({ status: null, stdout, stderr, timedOut, error: err.message });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

