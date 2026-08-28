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

// Cambia esta URL por la de tu Worker una vez lo despliegues con `wrangler deploy`.
const DEFAULT_CONFIG: LexemaConfig = {
  workerUrl: 'https://lexema-api.TU-SUBDOMINIO.workers.dev',
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
