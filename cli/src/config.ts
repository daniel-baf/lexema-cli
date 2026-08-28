import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(os.homedir(), '.lexema');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface LexemaConfig {
  workerUrl: string;
  token?: string;
  model?: string;
}

// Token compartido por defecto para los binarios públicos (release de GitHub).
// En un checkout local queda vacío a propósito: nunca se hardcodea el token
// real en el código fuente. El workflow de release lo inyecta en dist/config.js
// después de compilar (ver cli/scripts/inject-token.js), leyéndolo del secreto
// LEXEMA_CLIENT_TOKEN de GitHub Actions.
const DEFAULT_CLIENT_TOKEN = '';

const DEFAULT_CONFIG: LexemaConfig = {
  workerUrl: 'https://lexema-api.diego12.workers.dev',
  token: DEFAULT_CLIENT_TOKEN || undefined,
};

export function loadConfig(): LexemaConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: LexemaConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}
