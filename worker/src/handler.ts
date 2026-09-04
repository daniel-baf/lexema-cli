import crypto from 'node:crypto';
import { ResolvedConfig } from './config';
import { getProvider } from './ai';
import { ProviderError } from './ai/types';

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

// Fuente del archivo de actualización (GET /download): el servidor local
// implementa una que lee de disco; cfg.updateUrl es la alternativa remota
// (pasarela fetch) para cuando el archivo no vive en el propio disco.
export interface UpdateFile {
  bytes: Uint8Array;
  filename: string;
}
export type UpdateFileSource = () => Promise<UpdateFile | null>;

// Fuente del binario de la CLI para /install (GET /install/binary?os=...).
// El servidor local la implementa leyendo de disco según el OS pedido;
// si no hay binario para ese OS devuelve null y /install responde 404.
export type InstallBinarySource = (os: string) => Promise<UpdateFile | null>;

// Fuente del hash SHA-256 del binario de instalación, cacheado por mtime en
// server.ts (evita recalcular el hash en cada request a /install). Si no se
// pasa (o devuelve null), las rutas de /install caen a sha256Hex(bytes) leído
// de installBinary, sin romper la firma opcional de handleRequest.
export type InstallHashSource = (os: string) => Promise<string | null>;

// Valores válidos del parámetro ?os= de /install/binary: coinciden con los
// binarios que genera "make compile" (ver scripts/compile.mjs).
const OS_KEYS = ['linux-x64', 'linux-arm64', 'windows-x64'];

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

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Comparación de token en tiempo constante: timingSafeEqual exige buffers
// de igual longitud, así que un largo distinto ya es "no autorizado" sin
// necesidad de comparar byte a byte (ahí no hay señal de timing útil).
function tokensMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
// pasar el header dos veces. Autodetecta SO/arquitectura (uname) y baja el
// binario que corresponda de /install/binary?os=... Deja el binario en
// /usr/local/bin (con sudo si hace falta) y avisa si no está en el PATH.
// Windows no pasa por acá: usa GET /install.ps1 (irm | iex).
function buildInstallScript(
  origin: string,
  token?: string,
  hashes: { 'linux-x64'?: string; 'linux-arm64'?: string } = {}
): string {
  const authCurl = token ? `-H "Authorization: Bearer ${token}" ` : '';
  const authWget = token ? `--header="Authorization: Bearer ${token}" ` : '';
  return `#!/bin/sh
# Instalador de Lexema CLI (Linux) — servido por el propio servidor Lexema.
# Uso: curl -fsSL ${origin}/install | sh
set -e

SERVER="${origin}"
BIN_NAME="lexema"
INSTALL_DIR="/usr/local/bin"

case "\$(uname -s)-\$(uname -m)" in
  Linux-x86_64) OS="linux-x64" ;;
  Linux-aarch64|Linux-arm64) OS="linux-arm64" ;;
  *) echo "SO o arquitectura no soportada: \$(uname -s) \$(uname -m)" >&2
     echo "En Windows usá: irm ${origin}/install.ps1 | iex" >&2
     exit 1 ;;
esac

# Hash esperado por arquitectura, calculado por el servidor al generar este
# script (evita una segunda lectura del binario para chequear integridad).
case "\$OS" in
  linux-x64) EXPECTED_SHA256="${hashes['linux-x64'] || ''}" ;;
  linux-arm64) EXPECTED_SHA256="${hashes['linux-arm64'] || ''}" ;;
esac

fetch() { # $1=url $2=destino
  if command -v curl >/dev/null 2>&1; then
    curl -fSL ${authCurl}-o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget --show-progress ${authWget}-O "$2" "$1"
  else
    echo "Se necesita curl o wget para instalar." >&2
    exit 1
  fi
}

TMP="\$(mktemp)"
trap 'rm -f "\$TMP"' EXIT

echo "Detectado \$OS — descargando Lexema CLI desde \$SERVER..."
fetch "\$SERVER/install/binary?os=\$OS" "\$TMP"

echo "Verificando integridad (SHA-256)..."
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="\$(sha256sum "\$TMP" | cut -d ' ' -f1)"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA256="\$(shasum -a 256 "\$TMP" | cut -d ' ' -f1)"
else
  echo "No se encontró sha256sum ni shasum: no se puede verificar la integridad del binario." >&2
  exit 1
fi
if [ "\$ACTUAL_SHA256" != "\$EXPECTED_SHA256" ]; then
  echo "✖ Verificación de integridad fallida: el binario descargado no coincide con el esperado." >&2
  echo "  Esperado: \$EXPECTED_SHA256" >&2
  echo "  Obtenido: \$ACTUAL_SHA256" >&2
  exit 1
fi

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

// Contraparte de /install para Windows: script PowerShell que baja el .exe
// de /install/binary?os=windows-x64 y lo deja en un directorio del PATH de
// usuario (sin pedir admin). Uso: irm <servidor>/install.ps1 | iex
function buildInstallScriptPs(origin: string, token?: string, expectedSha256?: string): string {
  const authLine = token ? `\n$headers.Authorization = "Bearer ${token}"` : '';
  return `# Instalador de Lexema CLI (Windows) — servido por el propio servidor Lexema.
# Uso: irm ${origin}/install.ps1 | iex
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Server = "${origin}"
$Dir = "$env:LOCALAPPDATA\\Programs\\lexema"
$headers = @{}${authLine}
$ExpectedSha256 = "${expectedSha256 || ''}"

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Tmp = Join-Path $env:TEMP "lexema-install.exe"

Write-Host "Descargando Lexema CLI (windows-x64) desde $Server..."
Invoke-WebRequest -Uri "$Server/install/binary?os=windows-x64" -OutFile $Tmp -Headers $headers -UseBasicParsing

Write-Host "Verificando integridad (SHA-256)..."
$ActualSha256 = (Get-FileHash -Path $Tmp -Algorithm SHA256).Hash
if ($ActualSha256.ToLower() -ne $ExpectedSha256.ToLower()) {
  Remove-Item -Force $Tmp -ErrorAction SilentlyContinue
  Write-Error "Verificacion de integridad fallida. Esperado: $ExpectedSha256 - Obtenido: $ActualSha256"
  exit 1
}

$Dest = Join-Path $Dir "lexema.exe"
Move-Item -Force $Tmp $Dest

if (($env:Path -split ';') -notcontains $Dir) {
  [Environment]::SetEnvironmentVariable(
    "Path",
    [Environment]::GetEnvironmentVariable("Path", "User") + ";$Dir",
    "User"
  )
  Write-Host "Agregado $Dir al PATH de usuario. Reabri la terminal para que aplique."
}

Write-Host "OK Lexema CLI instalado en $Dest — proba: lexema models"
`;
}

// Contraparte de /install para borrar la CLI. A diferencia del instalador,
// no depende de binarios en el servidor (no llama a installBinary) y no
// toca ~/.lexema: un script vía "curl | sh" no debería borrar datos de
// usuario sin confirmación interactiva explícita, así que solo informa
// cómo hacerlo a mano.
function buildUninstallScript(): string {
  return `#!/bin/sh
# Desinstalador de Lexema CLI (Linux) — servido por el propio servidor Lexema.
# Uso: curl -fsSL <servidor>/uninstall | sh
set -e

BIN_PATH="/usr/local/bin/lexema"
CONFIG_DIR="\$HOME/.lexema"

if [ ! -e "\$BIN_PATH" ]; then
  echo "No se encontró Lexema CLI en \$BIN_PATH" >&2
  exit 1
fi

if [ -w "\$BIN_PATH" ]; then
  rm -f "\$BIN_PATH"
else
  echo "Se requieren permisos de administrador para borrar \$BIN_PATH" >&2
  sudo rm -f "\$BIN_PATH"
fi

echo "✔ Lexema CLI desinstalado (\$BIN_PATH)"
echo "Tu configuración sigue en \$CONFIG_DIR — borrala manualmente con: rm -rf \$CONFIG_DIR"
`;
}

function buildUninstallScriptPs(): string {
  return `# Desinstalador de Lexema CLI (Windows) — servido por el propio servidor Lexema.
# Uso: irm <servidor>/uninstall.ps1 | iex
$ErrorActionPreference = "Stop"

$Dir = "$env:LOCALAPPDATA\\Programs\\lexema"
$Dest = Join-Path $Dir "lexema.exe"
$ConfigDir = Join-Path $env:USERPROFILE ".lexema"

if (-not (Test-Path $Dest)) {
  Write-Error "No se encontró Lexema CLI en $Dest"
  exit 1
}

Remove-Item -Force $Dest
if ((Test-Path $Dir) -and ((Get-ChildItem $Dir -Force | Measure-Object).Count -eq 0)) {
  Remove-Item -Force $Dir
}

Write-Host "OK Lexema CLI desinstalado ($Dest)"
Write-Host "Tu configuracion sigue en $ConfigDir - borrala manualmente si queres: Remove-Item -Recurse -Force $ConfigDir"
`;
}

// Manejador HTTP del servidor local (server.ts). Recibe una Request estándar.
export async function handleRequest(
  request: Request,
  cfg: ResolvedConfig,
  kv?: KVLike,
  updateFile?: UpdateFileSource,
  installBinary?: InstallBinarySource,
  installHash?: InstallHashSource
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
    if (!tokensMatch(token, cfg.clientToken)) {
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
  // 1) updateFile: archivo local (servidor sobre Node).
  // 2) cfg.updateUrl: URL remota con pasarela fetch;
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

  // Instalación remota de la CLI (solo servidores con binarios en disco;
  // sin binario responde 404). GET /install devuelve el script sh (Linux,
  // autodetecta x64/arm64), GET /install.ps1 el de Windows y
  // GET /install/binary?os=... el binario compilado. Comparten la
  // autenticación global de arriba.
  if (request.method === 'GET' && (path === '/install' || path === '/install.sh')) {
    const linuxX64 = installBinary ? await installBinary('linux-x64') : null;
    const linuxArm64 = installBinary ? await installBinary('linux-arm64') : null;
    if (!linuxX64 && !linuxArm64) {
      return json(
        {
          error:
            'Binarios de la CLI no disponibles en el servidor. Compilá con "make compile" o define INSTALL_FILE en el .env.',
        },
        404
      );
    }
    // installHash usa el hash cacheado por mtime (server.ts); si no está
    // disponible caemos a calcularlo de los bytes ya leídos por installBinary,
    // sin leer el archivo de disco una segunda vez.
    const hashes = {
      'linux-x64': linuxX64
        ? (installHash && (await installHash('linux-x64'))) || sha256Hex(linuxX64.bytes)
        : undefined,
      'linux-arm64': linuxArm64
        ? (installHash && (await installHash('linux-arm64'))) || sha256Hex(linuxArm64.bytes)
        : undefined,
    };
    return new Response(
      buildInstallScript(new URL(request.url).origin, cfg.clientToken, hashes),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/x-shellscript; charset=utf-8',
          'Cache-Control': 'no-store',
          ...corsHeaders(),
        },
      }
    );
  }

  if (request.method === 'GET' && path === '/install.ps1') {
    const binary = installBinary ? await installBinary('windows-x64') : null;
    if (!binary) {
      return json(
        {
          error:
            'Binario de Windows no disponible en el servidor. Compilá con "make compile" (genera lexema-windows-x64.exe).',
        },
        404
      );
    }
    const winHash = (installHash && (await installHash('windows-x64'))) || sha256Hex(binary.bytes);
    return new Response(
      buildInstallScriptPs(new URL(request.url).origin, cfg.clientToken, winHash),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          ...corsHeaders(),
        },
      }
    );
  }

  // Desinstalador remoto: simétrico a /install pero no depende de binarios
  // en disco (nada que servir), así que nunca responde 404 por eso.
  if (request.method === 'GET' && (path === '/uninstall' || path === '/uninstall.sh')) {
    return new Response(buildUninstallScript(), {
      status: 200,
      headers: {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
        'Cache-Control': 'no-store',
        ...corsHeaders(),
      },
    });
  }

  if (request.method === 'GET' && path === '/uninstall.ps1') {
    return new Response(buildUninstallScriptPs(), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...corsHeaders(),
      },
    });
  }

  if (request.method === 'GET' && path === '/install/binary') {
    const requested = (new URL(request.url).searchParams.get('os') || '').trim();
    const os = OS_KEYS.includes(requested) ? requested : 'linux-x64';
    const binary = installBinary ? await installBinary(os) : null;
    if (!binary) {
      return json({ error: `Binario de la CLI no disponible en el servidor (os=${os})` }, 404);
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

  // Rate limiting opcional por IP (KV en memoria del servidor local). Ya no
  // hay Cloudflare por delante, así que la IP real viene del header interno
  // que server.ts setea desde el socket TCP (x-lexema-real-ip), pisando
  // cualquier valor que el cliente intente mandar con ese mismo nombre.
  if (kv) {
    const ip = request.headers.get('x-lexema-real-ip') || 'local';
    const limited = await rateLimited(ip, kv, cfg.dailyLimit);
    if (limited) return limited;
  }

  if (!cfg.apiKey) {
    return json(
      {
        error: 'El servidor no tiene configurada la clave de API. Define AI_API_KEY (o la variable del proveedor) en el .env.',
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
      timeoutMs: cfg.aiTimeoutMs,
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
