import axios, { AxiosError } from 'axios';
import { loadConfig } from './config';

export interface WorkerResponse {
  reply?: string;
  error?: string;
}

export interface ModelsInfo {
  provider: string;
  defaultModel: string;
  models: string[] | null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_CONVERSATION_CHARS = 3500;

export async function callWorker(prompt: string, model?: string): Promise<string> {
  const config = loadConfig();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  const res = await axios.post<WorkerResponse>(
    config.workerUrl,
    { prompt, model: model || config.model },
    { headers, timeout: 30000 }
  );

  if (!res.data.reply) {
    throw new Error(res.data.error || 'Respuesta vacía del servidor.');
  }
  return res.data.reply;
}

export async function fetchModels(): Promise<ModelsInfo> {
  const config = loadConfig();
  const headers: Record<string, string> = {};
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const res = await axios.get(`${config.workerUrl.replace(/\/+$/, '')}/models`, {
    headers,
    timeout: 10000,
  });
  return res.data as ModelsInfo;
}

export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError<WorkerResponse>;
    if (err.response) {
      const msg = err.response.data?.error || err.message;
      return `Error del servidor (${err.response.status}): ${msg}`;
    }
    if (err.code === 'ECONNABORTED') return 'Tiempo de espera agotado. Intenta de nuevo.';
    return `No se pudo conectar con Lexema Labs (${err.message}). Revisa tu conexión o "lexema config show".`;
  }
  if (error instanceof Error) return error.message;
  return 'Error inesperado.';
}

export function buildConversationPrompt(history: ChatTurn[], latest: string): string {
  if (history.length === 0) return latest;

  const keep: ChatTurn[] = [];
  let budget = MAX_CONVERSATION_CHARS - latest.length - 200;
  for (let i = history.length - 1; i >= 0; i--) {
    if (budget - history[i].content.length < 0) break;
    budget -= history[i].content.length;
    keep.unshift(history[i]);
  }

  const transcript = keep
    .map((t) => `${t.role === 'user' ? 'Usuario' : 'Asistente'}: ${t.content}`)
    .join('\n');

  return (
    'Historial de la conversación hasta ahora:\n\n' +
    transcript +
    '\n\nResponde como el asistente al siguiente mensaje del usuario:\n\n' +
    latest
  );
}
