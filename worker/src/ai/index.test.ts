import { describe, it, expect } from 'vitest';
import { getProvider, listProviderIds } from './index';

describe('getProvider', () => {
  it('resuelve alias en minúsculas', () => {
    const { provider } = getProvider('openrouter');
    expect(provider.id).toBe('openai');
  });

  it('resuelve alias sin importar mayúsculas/minúsculas', () => {
    const { provider } = getProvider('OpenRouter');
    expect(provider.id).toBe('openai');
  });

  it('resuelve alias con espacios alrededor', () => {
    const { provider } = getProvider(' groq ');
    expect(provider.id).toBe('openai');
  });

  it('sin nombre devuelve el proveedor por defecto (openai)', () => {
    const { provider } = getProvider();
    expect(provider.id).toBe('openai');
  });

  it('proveedor desconocido lanza error mencionando los soportados', () => {
    expect(() => getProvider('no-existe')).toThrow(/openai/);
    try {
      getProvider('no-existe');
    } catch (err) {
      expect((err as Error).message).toContain('openai');
      expect((err as Error).message).toContain('openrouter');
      expect((err as Error).message).toContain('groq');
    }
  });
});

describe('listProviderIds', () => {
  it('devuelve los IDs de proveedores registrados', () => {
    expect(listProviderIds()).toEqual(['openai']);
  });
});
