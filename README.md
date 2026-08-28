# Lexema CLI

CLI de IA para la terminal (`lexema ask`, `lexema chat`), con un Cloudflare
Worker como proxy que oculta tu clave de API. Costo de infraestructura: **$0**
(Cloudflare Workers free tier + Groq free tier + GitHub Releases).

```
lexema-project/
├── cli/            # El paquete de la CLI (TypeScript -> binario)
├── worker/         # El Worker de Cloudflare (proxy seguro hacia Groq)
├── install.sh      # Instalador para Linux/macOS
├── install.ps1      # Instalador para Windows
└── .github/workflows/release.yml   # Compila y publica binarios al crear un tag
```

## 0. Requisitos

- Cuenta de Cloudflare (ya tienes `lexemalabs.shop` configurado ahí).
- Cuenta de [Groq](https://console.groq.com) y una API key gratuita.
- Node.js 18+ y npm instalados en tu máquina.
- Un repositorio en GitHub (`diegoabdo/lexema-cli`) para alojar el código
  y los binarios compilados en *Releases*.

## 1. Desplegar el Worker (backend)

```bash
cd worker
npm install
npx wrangler login          # abre el navegador y autoriza tu cuenta de Cloudflare

# Configura los secretos (no se guardan en el código):
npx wrangler secret put GROQ_API_KEY
# pega tu clave de https://console.groq.com/keys

npx wrangler secret put CLIENT_TOKEN
# inventa un token largo y aleatorio, ej: openssl rand -hex 32
# Este token protege tu Worker de que cualquiera lo use y gaste tu cuota de Groq.

npm run deploy
```

Al terminar, `wrangler` te dará una URL como:

```
https://lexema-api.tu-subdominio.workers.dev
```

https://lexema-api.diego12.workers.dev


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

# Edita src/config.ts y cambia DEFAULT_CONFIG.workerUrl por tu URL real del Worker,
# o simplemente configúralo en caliente:
npm run build
node dist/index.js config set-url https://lexema-api.diego12.workers.dev https://lexema-api.tu-subdominio.workers.dev
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

## 5. Publicar `install.sh` en lexemalabs.shop

`install.sh` e `install.ps1` ya apuntan a `diegoabdo/lexema-cli`.

Copia `install.sh` (y opcionalmente `install.ps1`) a la carpeta del sitio
estático que ya despliegas en Cloudflare Pages para `lexemalabs.shop` (el
mismo repo/carpeta donde vive tu `index.html`), en la raíz, y haz push. Cloudflare
Pages lo desplegará junto con el resto del sitio y quedará disponible en:

```
https://lexemalabs.shop/install.sh
https://lexemalabs.shop/install.ps1
```

Tus usuarios podrán instalar con:

```bash
# Linux / macOS
curl -fsSL https://lexemalabs.shop/install.sh | bash

# Windows (PowerShell)
irm https://lexemalabs.shop/install.ps1 | iex
```

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

- **Streaming de respuestas** (Groq lo soporta) para que el texto aparezca
  palabra por palabra en vez de esperar la respuesta completa.
- **BYOK (Bring Your Own Key)**: dejar que cada usuario ponga su propia
  clave de Groq/Gemini con `lexema config set-key`, para no depender de tu
  cuota compartida a medida que crezca el uso.
- **Homebrew tap / Scoop manifest** para instalación más nativa en
  macOS/Windows, como alternativa a los scripts `curl | bash`.
- Revisar periódicamente `https://console.groq.com/docs/deprecations` — los
  proveedores de modelos retiran versiones con el tiempo.
