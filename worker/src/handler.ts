import { ResolvedConfig } from './config';
import { getProvider } from './ai';
import { ProviderError } from './ai/types';

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

// Fuente del archivo de actualización (GET /download). El servidor local
// implementa una que lee de disco; el Worker de Cloudflare usa UPDATE_URL.
export interface UpdateFile {
  bytes: Uint8Array;
  filename: string;
}
export type UpdateFileSource = () => Promise<UpdateFile | null>;

interface ChatRequestBody {
  prompt?: string;
  model?: string;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function rateLimited(ip: string, kv: KVLike, dailyLimit: number): Promise<Response | null> {
  return (async () => {
    const dayKey = `rl:${ip}:${new Date().toISOString().slice(0, 10)}`;
    const current = parseInt((await kv.get(dayKey)) || '0', 10);
    if (current >= dailyLimit) {
      return json({ error: 'Límite diario alcanzado, intenta mañana.' }, 429);
    }
    await kv.put(dayKey, String(current + 1), { expirationTtl: 60 * 60 * 24 });
    return null;
  })();
}

// Script de instalación que entrega GET /install. Se genera por pedido para
// embeber la URL del servidor y el token (si hay): así el flujo
// "curl -fsSL <servidor>/install | sh" funciona con un solo comando, sin
// pasar el header dos veces. Deja el binario en /usr/local/bin (con sudo si
// hace falta) y avisa si el directorio no está en el PATH.
function buildInstallScript(origin: string, token?: string): string {
  const authCurl = token ? `-H "Authorization: Bearer ${token}" ` : '';
  const authWget = token ? `--header="Authorization: Bearer ${token}" ` : '';
  return `#!/bin/sh
# Instalador de Lexema CLI — servido por el propio servidor Lexema.
# Uso: curl -fsSL ${origin}/install | sh
set -e

SERVER="${origin}"
BIN_NAME="lexema"
INSTALL_DIR="/usr/local/bin"

fetch() { # $1=url $2=destino
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL ${authCurl}-o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q ${authWget}-O "$2" "$1"
  else
    echo "Se necesita curl o wget para instalar." >&2
    exit 1
  fi
}

TMP="\$(mktemp)"
trap 'rm -f "\$TMP"' EXIT

echo "Descargando Lexema CLI desde \$SERVER..."
fetch "\$SERVER/install/binary" "\$TMP"
chmod +x "\$TMP"

if [ -w "\$INSTALL_DIR" ]; then
  mv -f "\$TMP" "\$INSTALL_DIR/\$BIN_NAME"
else
  echo "Se requieren permisos de administrador para instalar en \$INSTALL_DIR" >&2
  sudo mv -f "\$TMP" "\$INSTALL_DIR/\$BIN_NAME"
fi

echo "✔ Lexema CLI instalado en \$INSTALL_DIR/\$BIN_NAME"
case ":\$PATH:" in
  *":\$INSTALL_DIR:"*) ;;
  *) echo "⚠ Agrega \$INSTALL_DIR a tu PATH: export PATH=\\\$PATH:\$INSTALL_DIR" ;;
esac
echo "Probá: \$BIN_NAME models"
`;
}

// Manejador compartido entre el Worker de Cloudflare (index.ts) y el
// servidor local de pruebas (server.ts). Recibe una Request estándar.
export async function handleRequest(
  request: Request,
  cfg: ResolvedConfig,
  kv?: KVLike,
  updateFile?: UpdateFileSource,
  installBinary?: UpdateFileSource
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

  // Autenticación simple por token compartido (opcional pero recomendado).
  // Va antes de los GET: si no, /health y /models exponen el proveedor, el
  // modelo por defecto y la lista blanca a cualquiera con la URL.
  if (cfg.clientToken) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== cfg.clientToken) {
      return json({ error: 'No autorizado' }, 401);
    }
  }

  if (request.method === 'GET' && path === '/health') {
    return json({ ok: true, provider: cfg.providerId });
  }

  if (request.method === 'GET' && path === '/models') {
    return json({
      provider: cfg.providerId,
      providerLabel: cfg.providerLabel,
      defaultModel: cfg.defaultModel,
      models: cfg.allowedModels,
    });
  }

  // Entrega del updater. El servidor no decide nada: siempre envía el
  // archivo y la lógica de versiones/actualización vive en el propio
  // script que recibe la CLI. Dos fuentes, en orden:
  // 1) updateFile: archivo local (servidor de pruebas sobre Node).
  // 2) cfg.updateUrl: URL remota con pasarela fetch (Worker de Cloudflare);
  //    admite el placeholder {platform} (p.ej. linux-x64, win-x64.exe).
  if (request.method === 'GET' && path === '/download') {
    if (updateFile) {
      const file = await updateFile();
      if (file) {
        return new Response(file.bytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${file.filename}"`,
            ...corsHeaders(),
          },
        });
      }
    }
    if (cfg.updateUrl) {
      const platform = (new URL(request.url).searchParams.get('platform') || '').trim();
      const target = cfg.updateUrl.replace(/\{platform\}/g, platform);
      let upstream: Response;
      try {
        upstream = await fetch(target);
      } catch {
        return json({ error: 'No se pudo alcanzar el archivo de actualización' }, 502);
      }
      if (!upstream.ok || !upstream.body) {
        return json(
          { error: `El archivo de actualización no está disponible (${upstream.status})` },
          502
        );
      }
      const filename = decodeURIComponent(target.split('/').pop()?.split('?')[0] || '') ||
        'lexema-update.bin';
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${filename}"`,
          ...corsHeaders(),
        },
      });
    }
    return json({ error: 'Actualizaciones no configuradas en el servidor' }, 404);
  }

  // Instalación remota de la CLI (solo servidores con el binario en disco;
  // en Cloudflare no hay fuente y responde 404). GET /install devuelve el
  // script sh listo para "curl .../install | sh" y GET /install/binary el
  // binario compilado. Comparten la autenticación global de arriba.
  if (request.method === 'GET' && (path === '/install' || path === '/install.sh')) {
    const binary = installBinary ? await installBinary() : null;
    if (!binary) {
      return json(
        {
          error:
            'Binario de la CLI no disponible en el servidor. Compilá con "make compile" o define INSTALL_FILE en el .env.',
        },
        404
      );
    }
    return new Response(buildInstallScript(new URL(request.url).origin, cfg.clientToken), {
      status: 200,
      headers: {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
        'Cache-Control': 'no-store',
        ...corsHeaders(),
      },
    });
  }

  if (request.method === 'GET' && path === '/install/binary') {
    const binary = installBinary ? await installBinary() : null;
    if (!binary) {
      return json({ error: 'Binario de la CLI no disponible en el servidor' }, 404);
    }
    return new Response(binary.bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${binary.filename}"`,
        ...corsHeaders(),
      },
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Método no permitido' }, 405);
  }

  // Rate limiting opcional por IP (requiere un binding KV en Cloudflare,
  // o el KV en memoria del servidor local).
  if (kv) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const limited = await rateLimited(ip, kv, cfg.dailyLimit);
    if (limited) return limited;
  }

  if (!cfg.apiKey) {
    return json(
      {
        error: `El servidor no tiene configurada la clave de API. Define ${cfg.providerId === 'gemini' ? 'GEMINI_API_KEY' : 'AI_API_KEY (o la variable del proveedor)'} en el .env o en los secrets.`,
      },
      500
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const prompt = (body.prompt || '').trim();
  if (!prompt) {
    return json({ error: 'Falta el campo "prompt"' }, 400);
  }
  if (prompt.length > cfg.maxPromptLength) {
    return json(
      { error: `El prompt es demasiado largo (máx. ${cfg.maxPromptLength} caracteres)` },
      400
    );
  }

  const model = (body.model || '').trim() || cfg.defaultModel;
  if (cfg.allowedModels && !cfg.allowedModels.includes(model)) {
    return json(
      {
        error: `Modelo "${model}" no permitido. Modelos disponibles: ${cfg.allowedModels.join(', ')}`,
      },
      400
    );
  }

  try {
    const { provider } = getProvider(cfg.providerId);
    const reply = await provider.complete(prompt, model, {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      systemPrompt: cfg.systemPrompt,
    });
    return json({ reply, model });
  } catch (err) {
    if (err instanceof ProviderError) {
      return json({ error: err.message }, err.status);
    }
    console.error(err);
    return json({ error: 'Error procesando la petición' }, 500);
  }
}
