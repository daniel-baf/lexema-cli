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

  it('rechaza strings mal formados en vez de truncarlos (parseInt silencioso)', () => {
    // fallback distinto del resultado "parseable por accidente": si int()
    // truncara con parseInt, '50x' daría 50, no el fallback 999.
    const cfg = resolveConfig({ MAX_PROMPT_LENGTH: '50x' });
    expect(cfg.maxPromptLength).not.toBe(50);
    expect(cfg.maxPromptLength).toBe(4000);
  });

  it('UPDATE_URL presente se propaga tal cual', () => {
    const cfg = resolveConfig({ UPDATE_URL: 'https://ejemplo.com/{platform}' });
    expect(cfg.updateUrl).toBe('https://ejemplo.com/{platform}');
  });

  it('UPDATE_URL ausente da undefined', () => {
    expect(resolveConfig({}).updateUrl).toBeUndefined();
  });

  it('SYSTEM_PROMPT presente se propaga tal cual', () => {
    const cfg = resolveConfig({ SYSTEM_PROMPT: 'sé breve' });
    expect(cfg.systemPrompt).toBe('sé breve');
  });

  it('SYSTEM_PROMPT ausente da undefined', () => {
    expect(resolveConfig({}).systemPrompt).toBeUndefined();
  });

  it('CLIENT_TOKEN presente se propaga tal cual', () => {
    const cfg = resolveConfig({ CLIENT_TOKEN: 'secreto' });
    expect(cfg.clientToken).toBe('secreto');
  });

  it('CLIENT_TOKEN ausente da undefined', () => {
    expect(resolveConfig({}).clientToken).toBeUndefined();
  });

  it('AI_PROVIDER desconocido propaga el error de getProvider', () => {
    expect(() => resolveConfig({ AI_PROVIDER: 'no-existe' })).toThrow(/no-existe/);
  });

  it('AI_BASE_URL inválida hace fallar resolveConfig (fail-fast)', () => {
    expect(() => resolveConfig({ AI_BASE_URL: 'no-es-una-url' })).toThrow(/AI_BASE_URL inválida/);
  });

  it('usa el fallback de AI_TIMEOUT_MS si falta o es inválido, y respeta uno válido', () => {
    expect(resolveConfig({}).aiTimeoutMs).toBe(30000);
    expect(resolveConfig({ AI_TIMEOUT_MS: 'nan' }).aiTimeoutMs).toBe(30000);
    expect(resolveConfig({ AI_TIMEOUT_MS: '5000' }).aiTimeoutMs).toBe(5000);
  });
});
