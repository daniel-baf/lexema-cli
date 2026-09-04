import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import App from './App';
import { callWorker, fetchModels, buildConversationPrompt } from '../api';
import { loadConfig, saveConfig } from '../config';

vi.mock('../api', () => ({
  callWorker: vi.fn(),
  fetchModels: vi.fn(),
  describeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  buildConversationPrompt: vi.fn((_history: unknown[], latest: string) => latest),
  isAbortError: () => false,
}));

vi.mock('../config', () => ({
  loadConfig: vi.fn(() => ({ workerUrl: 'http://localhost:8787', token: undefined, model: undefined })),
  saveConfig: vi.fn(),
}));

// ink-testing-library (v4, la única compatible con Ink 5) no expone
// waitUntilExit -- eso solo existe en la instancia real de ink.render(). Para
// probar "/exit" mockeamos useApp() y verificamos que exit() fue llamado, en
// vez de esperar una salida real del proceso.
const exitMock = vi.fn();
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useApp: () => ({ exit: exitMock }),
  };
});

// Deja correr un tick real de macrotask. Hace falta en DOS puntos distintos:
// (1) justo después de render(), porque useInput registra su listener
// 'readable' en un useEffect que corre después del commit inicial -- el
// Stdin mock de ink-testing-library no bufferea, así que un write() antes de
// ese registro se pierde para siempre; y (2) entre un write() y el
// siguiente, porque cada re-render de App recrea el callback que useInput
// recibe (no está memoizado), y useInput vuelve a suscribirse con ese
// closure fresco en OTRO useEffect que también corre en un tick posterior al
// commit -- si el siguiente write() llega antes de esa resuscripción, lo
// procesa el listener viejo con estado (input/cursor) desactualizado.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// El cursor de InputBox inserta un carácter '▌' entre el texto antes y
// después de la posición del cursor, así que cuando el cursor no está al
// final el texto esperado no aparece como substring contiguo en el frame.
// Sacamos ese carácter antes de comparar.
function plainFrame(lastFrame: () => string | undefined): string {
  return (lastFrame() ?? '').replace(/▌/g, '');
}

beforeEach(() => {
  vi.mocked(callWorker).mockReset();
  vi.mocked(fetchModels).mockReset();
  vi.mocked(loadConfig).mockReturnValue({
    workerUrl: 'http://localhost:8787',
    token: undefined,
    model: undefined,
  });
  vi.mocked(saveConfig).mockReset();
  vi.mocked(buildConversationPrompt).mockClear();
  exitMock.mockReset();
});

describe('App (TUI)', () => {
  it('navega el historial de comandos enviados con flechas arriba/abajo, preservando el draft', async () => {
    vi.mocked(callWorker).mockResolvedValue('respuesta');
    const { stdin, lastFrame } = render(<App />);
    await flush();

    stdin.write('primero');
    await vi.waitFor(() => expect(lastFrame()).toContain('primero'));
    await flush();
    stdin.write('\r');
    await vi.waitFor(() => expect(lastFrame()).toContain('respuesta'));
    await flush();

    stdin.write('segundo');
    await vi.waitFor(() => expect(lastFrame()).toContain('segundo'));
    await flush();
    stdin.write('\r');
    await flush();

    // Empieza a escribir un draft que todavía no se envió.
    stdin.write('draft sin enviar');
    await vi.waitFor(() => expect(lastFrame()).toContain('draft sin enviar'));
    await flush();

    stdin.write('\x1B[A'); // arriba: último enviado ("segundo")
    await vi.waitFor(() => expect(lastFrame()).toContain('segundo'));
    await flush();

    stdin.write('\x1B[A'); // arriba de nuevo: el anterior ("primero")
    await vi.waitFor(() => expect(lastFrame()).toContain('primero'));
    await flush();

    stdin.write('\x1B[B'); // abajo: vuelve a "segundo"
    await vi.waitFor(() => expect(lastFrame()).toContain('segundo'));
    await flush();

    stdin.write('\x1B[B'); // abajo, pasando el final: recupera el draft
    await vi.waitFor(() => expect(lastFrame()).toContain('draft sin enviar'));
  });

  it('distingue backspace (borra hacia atrás) de delete (borra hacia adelante)', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();

    stdin.write('abcde');
    await vi.waitFor(() => expect(plainFrame(lastFrame)).toContain('abcde'));
    await flush();
    // Cursor queda al final (posición 5). Movemos 2 a la izquierda -> pos 3.
    stdin.write('\x1B[D');
    await flush();
    stdin.write('\x1B[D');
    await flush();

    // Backspace (byte crudo \x7f) borra el carácter ANTES del cursor: "c".
    stdin.write('\x7f');
    await vi.waitFor(() => expect(plainFrame(lastFrame)).toContain('abde'));
    await flush();

    // Delete forward (secuencia de escape real de la tecla Delete) borra el
    // carácter EN el cursor (ahora en pos 2, sobre "d").
    stdin.write('\x1B[3~');
    await vi.waitFor(() => expect(plainFrame(lastFrame)).toContain('abe'));
  });

  it('/clear resetea entries e historial', async () => {
    vi.mocked(callWorker).mockResolvedValue('respuesta');
    const { stdin, lastFrame } = render(<App />);
    await flush();

    stdin.write('hola');
    await vi.waitFor(() => expect(lastFrame()).toContain('hola'));
    await flush();
    stdin.write('\r');
    await vi.waitFor(() => expect(lastFrame()).toContain('respuesta'));
    await flush();

    stdin.write('/clear');
    await vi.waitFor(() => expect(lastFrame()).toContain('/clear'));
    await flush();
    stdin.write('\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('Conversación borrada.'));
    await flush();

    // ink-testing-library corre Ink en modo debug, que reescribe TODO el
    // output estático acumulado (this.fullStaticOutput) en cada frame -- una
    // vez impreso, "respuesta" nunca desaparece de lastFrame() aunque el
    // estado de React sí se resetee. Por eso verificamos el reset real del
    // historial de conversación (historyRef) por un canal indirecto: el
    // próximo mensaje debe construirse con historial vacío.
    vi.mocked(buildConversationPrompt).mockClear();
    stdin.write('otro');
    await vi.waitFor(() => expect(lastFrame()).toContain('otro'));
    await flush();
    stdin.write('\r');

    await vi.waitFor(() => expect(vi.mocked(buildConversationPrompt)).toHaveBeenCalled());
    expect(vi.mocked(buildConversationPrompt).mock.calls[0]?.[0]).toEqual([]);
  });

  it('/help muestra el texto de ayuda en un notice', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();

    stdin.write('/help');
    await vi.waitFor(() => expect(lastFrame()).toContain('/help'));
    await flush();
    stdin.write('\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('Comandos:'));
  });

  it('/model sin argumento muestra la info de fetchModels', async () => {
    vi.mocked(fetchModels).mockResolvedValue({
      provider: 'openai',
      defaultModel: 'gpt-4',
      models: ['gpt-4', 'gpt-3.5'],
    });
    const { stdin, lastFrame } = render(<App />);
    await flush();

    stdin.write('/model');
    await vi.waitFor(() => expect(lastFrame()).toContain('/model'));
    await flush();
    stdin.write('\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('openai'));
    expect(lastFrame()).toContain('gpt-4');
  });

  it('/exit dispara la salida de la app', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();

    stdin.write('/exit');
    await vi.waitFor(() => expect(lastFrame()).toContain('/exit'));
    await flush();
    stdin.write('\r');

    await vi.waitFor(() => expect(exitMock).toHaveBeenCalled());
  });
});
