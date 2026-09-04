export interface ProviderContext {
  apiKey: string;
  baseUrl: string;
  systemPrompt?: string;
  timeoutMs: number;
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

export interface ProviderErrorLabels {
  logPrefix: string;
  rateLimited: string;
  authRejected: string;
  modelNotFound: (model: string) => string;
}

// Mapeo compartido de una respuesta HTTP no-ok a un ProviderError. Los
// mensajes en español siguen siendo específicos por proveedor vía `labels`.
export async function mapHttpErrorToProviderError(
  res: Response,
  model: string,
  labels: ProviderErrorLabels
): Promise<ProviderError> {
  const errText = await readErrorBody(res);
  console.error(`${labels.logPrefix}:`, res.status, errText);
  if (res.status === 429) {
    return new ProviderError(labels.rateLimited, 429);
  }
  if (res.status === 401 || res.status === 403) {
    return new ProviderError(labels.authRejected, 502);
  }
  if (res.status === 404) {
    return new ProviderError(labels.modelNotFound(model), 502);
  }
  return new ProviderError('Error del proveedor de IA.', 502);
}
