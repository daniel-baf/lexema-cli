import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFilename, saveUpdateFile } from './updater';

describe('parseFilename', () => {
  it('extrae el filename de un Content-Disposition normal', () => {
    expect(parseFilename('attachment; filename="test.sh"', 'fallback.bin')).toBe('test.sh');
  });

  it('usa el fallback si no hay header', () => {
    expect(parseFilename(undefined, 'lexema-update.bin')).toBe('lexema-update.bin');
    expect(parseFilename('attachment', 'lexema-update.bin')).toBe('lexema-update.bin');
  });

  it('sanea intentos de path traversal quedándose con el basename', () => {
    expect(parseFilename('attachment; filename="../../evil.sh"', 'f.bin')).toBe('evil.sh');
  });
});

describe('saveUpdateFile', () => {
  it('guarda el archivo con permisos de ejecución y devuelve la ruta', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexema-updater-'));
    const saved = saveUpdateFile(Buffer.from('#!/bin/bash\necho hola\n'), 'test.sh', dir);
    expect(saved).toBe(path.join(dir, 'test.sh'));
    expect(fs.readFileSync(saved, 'utf8')).toContain('echo hola');
    const mode = fs.statSync(saved).mode & 0o777;
    expect(mode & 0o111).not.toBe(0); // ejecutable
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
