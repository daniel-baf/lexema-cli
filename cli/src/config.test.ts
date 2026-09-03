import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

describe('loadConfig / saveConfig', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lexema-config-test-'));
    vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('devuelve la config por defecto si no existe archivo', async () => {
    const { loadConfig } = await import('./config');
    const cfg = loadConfig();
    expect(cfg.workerUrl).toBe('http://localhost:8787');
  });

  it('guarda y vuelve a leer la config (round-trip)', async () => {
    const { loadConfig, saveConfig } = await import('./config');
    saveConfig({ workerUrl: 'http://localhost:8787', token: 'abc', model: 'gpt-4' });
    const cfg = loadConfig();
    expect(cfg).toEqual({ workerUrl: 'http://localhost:8787', token: 'abc', model: 'gpt-4' });
  });

  it('crea el directorio de config si no existe', async () => {
    const { saveConfig } = await import('./config');
    saveConfig({ workerUrl: 'http://localhost:8787' });
    expect(fs.existsSync(path.join(tmpHome, '.lexema', 'config.json'))).toBe(true);
  });
});
