# Lexema CLI

CLI de IA para la terminal (`lexema ask`, `lexema chat`), con un Cloudflare
Worker como proxy que oculta tu clave de API. Costo de infraestructura: **$0**
(Cloudflare Workers free tier + Gemini API free tier + GitHub Releases).

```
lexema-project/
├── cli/            # El paquete de la CLI (TypeScript -> binario)
├── worker/         # El Worker de Cloudflare (proxy seguro hacia Gemini)
├── install.sh      # Instalador para Linux/macOS
├── install.ps1      # Instalador para Windows
└── .github/workflows/release.yml   # Compila y publica binarios al crear un tag
```

## 0. Requisitos

- Cuenta de Cloudflare.
- Una API key de [Google AI Studio](https://aistudio.google.com/apikey) (Gemini), gratuita.
- Node.js 18+ y npm instalados en tu máquina.
- Un repositorio en GitHub (`diegoabdo/lexema-cli`) para alojar el código
  y los binarios compilados en *Releases*.
- (Opcional) Un dominio propio si quieres publicar el instalador en tu
  propia URL en vez de compartir el enlace a GitHub Releases.

## 1. Desplegar el Worker (backend)

```bash
cd worker
npm install
npx wrangler login          # abre el navegador y autoriza tu cuenta de Cloudflare

# Configura los secretos (no se guardan en el código):
npx wrangler secret put GEMINI_API_KEY
# pega tu clave de https://aistudio.google.com/apikey

npx wrangler secret put CLIENT_TOKEN
# inventa un token largo y aleatorio.
# En Linux/macOS: openssl rand -hex 32
# En Windows (PowerShell), si no tienes openssl:
#   $b = New-Object byte[] 32
#   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
#   ($b | ForEach-Object { $_.ToString("x2") }) -join ''
# Este token protege tu Worker de que cualquiera lo use y gaste tu cuota de Gemini.
#
# Importante: si pegas el token con un pipe (`$token | wrangler secret put ...`)
# en PowerShell, se le puede colar un salto de línea al final y el token dejará
# de coincidir con el que guardes en la CLI. Usa el prompt interactivo de
# `wrangler secret put` (pégalo a mano) o, en bash, `printf '%s' "$TOKEN" | wrangler secret put CLIENT_TOKEN`.

npm run deploy
```

Al terminar, `wrangler` te dará una URL como:

```
https://lexema-api.<tu-subdominio>.workers.dev
```

Guárdala, la necesitas en el paso 2.

### (Opcional pero recomendado) Rate limiting por IP

Un token compartido dentro de un binario público **se puede extraer** por un
usuario con conocimientos técnicos, así que no es una protección perfecta.
Para un límite adicional, activa Workers KV:

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

Copia el `id` que te devuelve y descomenta el bloque `[[kv_namespaces]]` en
`worker/wrangler.toml`, luego vuelve a correr `npm run deploy`. Con esto,
cada IP queda limitada a 100 peticiones por día (ajustable en `src/index.ts`,
constante `DAILY_LIMIT`).

## 2. Configurar y probar la CLI en local

```bash
cd cli
npm install
npm run build

node dist/index.js config set-url https://lexema-api.<tu-subdominio>.workers.dev
node dist/index.js config set-token EL_MISMO_TOKEN_QUE_PUSISTE_EN_CLIENT_TOKEN

node dist/index.js ask "Hola, preséntate en una línea"
node dist/index.js chat
```

Si todo responde bien, ya tienes el flujo completo funcionando en local.

## 3. Publicar el código en GitHub

```bash
cd ..   # raíz de lexema-project
git init
git add .
git commit -m "Lexema CLI inicial"
git branch -M main
git remote add origin https://github.com/diegoabdo/lexema-cli.git
git push -u origin main
```

> El Worker (`worker/`) puede vivir en el mismo repo (como aquí) o en uno
> aparte; no afecta el resto de la guía.

## 4. Publicar binarios automáticamente (GitHub Actions)

El workflow en `.github/workflows/release.yml` ya está listo: compila la CLI
para Linux, macOS (Intel y Apple Silicon) y Windows, y sube los binarios a un
Release cada vez que subes un tag `vX.Y.Z`.

```bash
git tag v1.0.0
git push origin v1.0.0
```

Ve a la pestaña **Actions** de tu repo para ver el progreso, y a
**Releases** cuando termine. Deberías obtener 4 archivos:

- `lexema-linux-x64`
- `lexema-macos-x64`
- `lexema-macos-arm64`
- `lexema-win-x64.exe`

Nota: los binarios de macOS se compilan en un runner `macos-latest` y se
firman con `codesign --sign -` (firma ad-hoc). Si los compilas tú mismo en
Linux en vez de usar el workflow, macOS matará el ejecutable al abrirlo a
menos que lo firmes desde un Mac o instales la utilidad `ldid`.

## 5. Publicar el instalador en tu propio dominio (opcional)

Si no quieres depender de una URL de `github.com`, puedes servir
`install.sh`/`install.ps1` desde cualquier hosting estático que ya tengas
(por ejemplo, un sitio en Cloudflare Pages). `install.sh` e `install.ps1` ya
apuntan a `diegoabdo/lexema-cli` como repositorio de releases.

Copia ambos archivos a la raíz de ese sitio y haz push; una vez desplegado
quedarán disponibles en tu dominio, por ejemplo:

```
https://tu-dominio.com/install.sh
https://tu-dominio.com/install.ps1
```

Tus usuarios podrán instalar con:

```bash
# Linux / macOS
curl -fsSL https://tu-dominio.com/install.sh | bash

# Windows (PowerShell)
irm https://tu-dominio.com/install.ps1 | iex
```

Si prefieres no usar un dominio propio, tus usuarios también pueden descargar
los binarios directamente desde
`https://github.com/diegoabdo/lexema-cli/releases`.

Y luego usar:

```bash
lexema ask "¿Qué es Lexema Labs?"
lexema chat
```

## Comandos de la CLI

| Comando | Descripción |
|---|---|
| `lexema ask "<prompt>"` | Pregunta puntual |
| `lexema chat` | Sesión interactiva (escribe "salir" para terminar) |
| `lexema config show` | Ver configuración actual |
| `lexema config set-url <url>` | Cambiar la URL del Worker |
| `lexema config set-token <token>` | Guardar el token de autenticación |
| `lexema config set-model <modelo>` | Fijar un modelo por defecto |

La configuración se guarda en `~/.lexema/config.json`.

## Siguientes pasos sugeridos (no incluidos todavía)

- **Streaming de respuestas** (Gemini lo soporta vía `streamGenerateContent`)
  para que el texto aparezca palabra por palabra en vez de esperar la
  respuesta completa.
- **BYOK (Bring Your Own Key)**: dejar que cada usuario ponga su propia
  clave de Gemini con `lexema config set-key`, para no depender de tu
  cuota compartida a medida que crezca el uso.
- **Homebrew tap / Scoop manifest** para instalación más nativa en
  macOS/Windows, como alternativa a los scripts `curl | bash`.
- Revisar periódicamente `https://ai.google.dev/gemini-api/docs/models` — los
  proveedores de modelos retiran versiones con el tiempo.
