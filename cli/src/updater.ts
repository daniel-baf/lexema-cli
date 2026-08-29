import axios from 'axios';
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

export async function downloadUpdateFile(): Promise<DownloadedUpdate> {
  const res = await axios.get(`${workerBase()}/download`, {
    params: { platform: process.platform },
    headers: authHeaders(),
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT_MS,
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

