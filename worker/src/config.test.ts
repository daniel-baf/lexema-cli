import { describe, it, expect } from 'vitest';
import { resolveConfig } from './config';

describe('resolveConfig', () => {
  it('prioriza la env var específica del proveedor sobre AI_API_KEY', () => {
    const cfg = resolveConfig({
      AI_PROVIDER: 'openai',
      OPENROUTER_API_KEY: 'specific',
      AI_API_KEY: 'generic',
    });
    expect(cfg.apiKey).toBe('specific');
  });

  it('cae a AI_API_KEY si no hay ninguna específica', () => {
    const cfg = resolveConfig({ AI_PROVIDER: 'openai', AI_API_KEY: 'generic' });
    expect(cfg.apiKey).toBe('generic');
  });

  it('resuelve el baseUrl del alias openrouter', () => {
    const cfg = resolveConfig({ AI_PROVIDER: 'openrouter' });
    expect(cfg.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('resuelve el baseUrl del alias groq', () => {
    const cfg = resolveConfig({ AI_PROVIDER: 'groq' });
    expect(cfg.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('AI_BASE_URL gana sobre el alias', () => {
    const cfg = resolveConfig({
      AI_PROVIDER: 'openrouter',
      AI_BASE_URL: 'http://localhost:1234/v1',
    });
    expect(cfg.baseUrl).toBe('http://localhost:1234/v1');
  });

  it('parsea AI_ALLOWED_MODELS como CSV', () => {
    const cfg = resolveConfig({ AI_ALLOWED_MODELS: 'gpt-4, gpt-3.5 ,,' });
    expect(cfg.allowedModels).toEqual(['gpt-4', 'gpt-3.5']);
  });

  it('AI_ALLOWED_MODELS vacío o ausente da null (sin restricción)', () => {
    expect(resolveConfig({}).allowedModels).toBeNull();
    expect(resolveConfig({ AI_ALLOWED_MODELS: '' }).allowedModels).toBeNull();
  });

  it('usa el fallback numérico si MAX_PROMPT_LENGTH/DAILY_LIMIT faltan o son inválidos', () => {
    expect(resolveConfig({}).maxPromptLength).toBe(4000);
    expect(resolveConfig({}).dailyLimit).toBe(100);
    expect(resolveConfig({ MAX_PROMPT_LENGTH: 'nan' }).maxPromptLength).toBe(4000);
    expect(resolveConfig({ DAILY_LIMIT: '-5' }).dailyLimit).toBe(100);
  });

  it('respeta MAX_PROMPT_LENGTH/DAILY_LIMIT válidos', () => {
    const cfg = resolveConfig({ MAX_PROMPT_LENGTH: '2000', DAILY_LIMIT: '50' });
    expect(cfg.maxPromptLength).toBe(2000);
    expect(cfg.dailyLimit).toBe(50);
  });
});
