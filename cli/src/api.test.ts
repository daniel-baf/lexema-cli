import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { describeError, buildConversationPrompt, ChatTurn, WorkerResponse } from './api';

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
