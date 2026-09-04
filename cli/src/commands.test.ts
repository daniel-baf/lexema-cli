import { describe, it, expect } from 'vitest';
import { parseSlashCommand, validateModel } from './commands';

describe('parseSlashCommand', () => {
  it('separa comando y argumento en el primer espacio', () => {
    expect(parseSlashCommand('/model gpt-4')).toEqual({ cmd: '/model', arg: 'gpt-4' });
  });

  it('comando sin argumento devuelve arg vacío', () => {
    expect(parseSlashCommand('/clear')).toEqual({ cmd: '/clear', arg: '' });
  });

  it('trimea espacios sobrantes del argumento', () => {
    expect(parseSlashCommand('/model   ')).toEqual({ cmd: '/model', arg: '' });
  });

  it('mensaje normal (sin "/" inicial) se parsea igual, solo por el espacio', () => {
    expect(parseSlashCommand('hola mundo')).toEqual({ cmd: 'hola', arg: 'mundo' });
  });
});

describe('validateModel', () => {
  it('true si el modelo está en la lista permitida', () => {
    expect(validateModel('gpt-4', ['gpt-4', 'gpt-3.5'])).toBe(true);
  });

  it('false si el modelo no está en la lista permitida', () => {
    expect(validateModel('bogus', ['gpt-4'])).toBe(false);
  });

  it('true sin restricción (allowed === null)', () => {
    expect(validateModel('anything', null)).toBe(true);
  });
});
