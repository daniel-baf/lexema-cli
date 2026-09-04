import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Rutas conocidas del binario instalado, simétricas a las que usan los
// scripts de /install y /install.ps1 del worker.
export function resolveBinaryPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Programs', 'lexema', 'lexema.exe');
  }
  return '/usr/local/bin/lexema';
}

export function resolveConfigDir(): string {
  return path.join(os.homedir(), '.lexema');
}

export function binaryExists(binPath: string): boolean {
  return fs.existsSync(binPath);
}
