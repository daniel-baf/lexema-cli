export interface ProviderContext {
  apiKey: string;
  baseUrl: string;
  systemPrompt?: string;
}

export interface AIProvider {
  id: string;
  label: string;
  defaultBaseUrl: string;
  /** Variables de entorno aceptadas como API key, en orden de prioridad. */
  keyEnvVars: string[];
  defaultModel: string;
  complete(prompt: string, model: string, ctx: ProviderContext): Promise<string>;
}

export class ProviderError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export async function readErrorBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
