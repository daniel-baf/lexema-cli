import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import {
  describeError,
  buildConversationPrompt,
  callWorker,
  fetchModels,
  isAbortError,
  ChatTurn,
  WorkerResponse,
} from './api';
import { loadConfig } from './config';

vi.mock('./config', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, post: vi.fn(), get: vi.fn() } };
});

const DEFAULT_CONFIG = { workerUrl: 'http://localhost:8787', token: undefined, model: undefined };

beforeEach(() => {
  vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG });
});

function axiosErrorWithResponse(status: number, data: WorkerResponse): AxiosError<WorkerResponse> {
  const err = new AxiosError('Request failed', undefined, undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });
  return err;
}

describe('describeError', () => {
  it('formatea un error de axios con respuesta del servidor', () => {
    const err = axiosErrorWithResponse(429, { error: 'límite alcanzado' });
    expect(describeError(err)).toBe('Error del servidor (429): límite alcanzado');
  });

  it('formatea timeout (ECONNABORTED)', () => {
    const err = new AxiosError('timeout');
    err.code = 'ECONNABORTED';
    expect(describeError(err)).toBe('Tiempo de espera agotado. Intenta de nuevo.');
  });

  it('formatea error de red sin respuesta', () => {
    const err = new AxiosError('Network Error');
    expect(describeError(err)).toContain('No se pudo conectar con Lexema Labs');
  });

  it('usa error.message para Error genérico', () => {
    expect(describeError(new Error('algo falló'))).toBe('algo falló');
  });

  it('devuelve mensaje genérico para valores desconocidos', () => {
    expect(describeError('cualquier cosa')).toBe('Error inesperado.');
  });
});

describe('callWorker', () => {
  it('no lanza con reply vacío ("") — es una respuesta legítima del modelo', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { reply: '' } });
    const reply = await callWorker('hola');
    expect(reply).toBe('');
  });

  it('propaga sin transformar el error de un AbortSignal ya abortado', async () => {
    // Comportamiento real de axios ante un signal ya abortado: rechaza con
    // un CanceledError (code ERR_CANCELED, axios.isCancel() lo reconoce).
    const cancelError = new AxiosError('canceled');
    cancelError.code = 'ERR_CANCELED';
    vi.mocked(axios.post).mockRejectedValue(cancelError);

    const controller = new AbortController();
    controller.abort();

    await expect(callWorker('hola', undefined, controller.signal)).rejects.toBe(cancelError);
    // isAbortError debe reconocer este error como cancelación explícita.
    expect(isAbortError(cancelError)).toBe(true);
  });

  it('arma el body con el prompt y el modelo pasado por parámetro', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { reply: 'ok' } });
    await callWorker('hola', 'gpt-4');
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:8787',
      { prompt: 'hola', model: 'gpt-4' },
      expect.objectContaining({ timeout: 30000 })
    );
  });

  it('usa config.model cuando no se pasa modelo por parámetro', async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG, model: 'config-model' });
    vi.mocked(axios.post).mockResolvedValue({ data: { reply: 'ok' } });
    await callWorker('hola');
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:8787',
      { prompt: 'hola', model: 'config-model' },
      expect.anything()
    );
  });

  it('agrega header Authorization solo si hay token', async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG, token: 'secreto' });
    vi.mocked(axios.post).mockResolvedValue({ data: { reply: 'ok' } });
    await callWorker('hola');
    expect(axios.post).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secreto' }) })
    );
  });

  it('no agrega header Authorization sin token', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { reply: 'ok' } });
    await callWorker('hola');
    const [, , config] = vi.mocked(axios.post).mock.calls[0];
    expect((config as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
  });

  it('postea a config.workerUrl tal cual, sin trimear "/" finales', async () => {
    // callWorker, a diferencia de fetchModels, no le hace .replace() a la
    // URL: postea directo a config.workerUrl.
    vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG, workerUrl: 'http://localhost:8787/' });
    vi.mocked(axios.post).mockResolvedValue({ data: { reply: 'ok' } });
    await callWorker('hola');
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:8787/',
      expect.anything(),
      expect.anything()
    );
  });
});

describe('fetchModels', () => {
  it('arma la URL sobre config.workerUrl agregando /models', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { provider: 'p', defaultModel: 'd', models: null } });
    await fetchModels();
    expect(axios.get).toHaveBeenCalledWith(
      'http://localhost:8787/models',
      expect.objectContaining({ timeout: 10000 })
    );
  });

  it('no duplica "/" si config.workerUrl termina en "/"', async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG, workerUrl: 'http://localhost:8787/' });
    vi.mocked(axios.get).mockResolvedValue({ data: { provider: 'p', defaultModel: 'd', models: null } });
    await fetchModels();
    expect(axios.get).toHaveBeenCalledWith(
      'http://localhost:8787/models',
      expect.anything()
    );
  });

  it('agrega header Authorization solo si hay token', async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG, token: 'secreto' });
    vi.mocked(axios.get).mockResolvedValue({ data: { provider: 'p', defaultModel: 'd', models: null } });
    await fetchModels();
    expect(axios.get).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secreto' }) })
    );
  });

  it('no agrega header Authorization sin token', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { provider: 'p', defaultModel: 'd', models: null } });
    await fetchModels();
    const [, config] = vi.mocked(axios.get).mock.calls[0];
    expect((config as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
  });

  it('devuelve el body de la respuesta tal cual', async () => {
    const data = { provider: 'p', defaultModel: 'd', models: ['a', 'b'] };
    vi.mocked(axios.get).mockResolvedValue({ data });
    const info = await fetchModels();
    expect(info).toEqual(data);
  });
});

describe('buildConversationPrompt', () => {
  it('devuelve solo el mensaje si no hay historial', () => {
    expect(buildConversationPrompt([], 'hola')).toBe('hola');
  });

  it('incluye el historial previo en el prompt', () => {
    const history: ChatTurn[] = [
      { role: 'user', content: 'primera pregunta' },
      { role: 'assistant', content: 'primera respuesta' },
    ];
    const prompt = buildConversationPrompt(history, 'segunda pregunta');
    expect(prompt).toContain('Usuario: primera pregunta');
    expect(prompt).toContain('Asistente: primera respuesta');
    expect(prompt).toContain('segunda pregunta');
  });

  it('recorta turnos antiguos cuando se supera el presupuesto de caracteres', () => {
    const history: ChatTurn[] = [
      { role: 'user', content: 'x'.repeat(5000) },
      { role: 'assistant', content: 'reciente' },
    ];
    const prompt = buildConversationPrompt(history, 'nueva pregunta');
    expect(prompt).not.toContain('x'.repeat(5000));
    expect(prompt).toContain('reciente');
  });
});
