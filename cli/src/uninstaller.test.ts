import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveBinaryPath, resolveConfigDir } from './uninstaller';

describe('resolveBinaryPath', () => {
  it('en Linux devuelve /usr/local/bin/lexema', () => {
    expect(resolveBinaryPath('linux')).toBe('/usr/local/bin/lexema');
  });

  it('en Windows devuelve %LOCALAPPDATA%\\Programs\\lexema\\lexema.exe', () => {
    const prevLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    try {
      expect(resolveBinaryPath('win32')).toBe(
        path.join('C:\\Users\\test\\AppData\\Local', 'Programs', 'lexema', 'lexema.exe')
      );
    } finally {
      if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = prevLocalAppData;
    }
  });

  it('en Windows sin LOCALAPPDATA cae a homedir/AppData/Local', () => {
    const prevLocalAppData = process.env.LOCALAPPDATA;
    delete process.env.LOCALAPPDATA;
    try {
      const result = resolveBinaryPath('win32');
      expect(result.endsWith(path.join('AppData', 'Local', 'Programs', 'lexema', 'lexema.exe'))).toBe(
        true
      );
    } finally {
      if (prevLocalAppData !== undefined) process.env.LOCALAPPDATA = prevLocalAppData;
    }
  });
});

describe('resolveConfigDir', () => {
  it('devuelve ~/.lexema', () => {
    expect(resolveConfigDir().endsWith('.lexema')).toBe(true);
  });
});
