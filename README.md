# Lexema CLI

CLI de IA para la terminal (`lexema ask`, `lexema chat`), con un Cloudflare
Worker como proxy que oculta tu clave de API. El proveedor de IA es
**agnóstico**: Gemini, OpenRouter, OpenAI, Groq o cualquier endpoint
compatible — todo se configura con variables de entorno. Costo de
infraestructura: **$0** (Cloudflare Workers free tier + free tier del
proveedor + GitHub Releases).

```
lexema-cli/
├── cli/            # El paquete de la CLI (TypeScript -> binario)
├── worker/         # El Worker de Cloudflare / servidor local (proxy hacia la IA)
├── scripts/        # Scripts de utilidad (SCREAM): up, smoke-test, demo, inject-token
├── Makefile        # Comandos de desarrollo: make install, env, up, test...
├── install.sh      # Instalador para Linux/macOS
├── install.ps1      # Instalador para Windows
└── .github/workflows/release.yml   # Compila y publica binarios al crear un tag
```

## 0. Requisitos

- Node.js 18+ y npm.
- Una API key de cualquier proveedor soportado:
  - [Google AI Studio](https://aistudio.google.com/apikey) (Gemini, gratuita)
  - [OpenRouter](https://openrouter.ai/keys), OpenAI, Groq, ... o un LLM local
- Para producción: cuenta de Cloudflare. **Para probar en local no
  necesitas nada de Cloudflare.**

## 1. Probar en local (sin Cloudflare)

Todo el flujo completo corre sobre Node puro con el mismo handler del Worker:

```bash
make install    # npm install en cli/ y worker/
make env        # crea worker/.env desde .env.example
$EDITOR worker/.env   # pon tu proveedor y API key
make up         # levanta el servidor en :8787 y abre el chat
```

`make up` detiene el servidor al salir del chat. Alternativas:
`make server` (solo el servidor), `make build` (solo compila cli/dist),
`make ask P="hola"`, `make models`,
`make test` (tipos + smoke test + demo con mocks, sin claves reales).

Luego apunta la CLI al servidor local (make up ya lo hace por ti):

```bash
node cli/dist/index.mjs config set-url http://localhost:8787
node cli/dist/index.mjs config set-token EL_MISMO_CLIENT_TOKEN_DEL_.env
```

### Probar desde otro dispositivo de tu LAN

`make server`/`make up` ya escuchan en todas las interfaces, no solo en
`localhost`. Para apuntar la CLI (de esta u otra máquina) a la IP correcta
sin adivinar ni escribir `config set-url` a mano:

```bash
make use-lan
```

Detecta las IPs de red de tu PC (LAN, Tailscale, etc.), te deja elegir cuál
usar y configura la CLI automáticamente (URL + token, si hay `CLIENT_TOKEN`
en `worker/.env`).

> **Firewall del host**: hacer `ping` a la IP no confirma que el puerto del
> servidor esté abierto — ICMP y TCP son cosas distintas, y un firewall que
> deja pasar el ping puede seguir bloqueando el puerto. Si desde otra
> máquina/VM el chat se queda colgado en "pensando..." hasta agotar el
> tiempo de espera (pero el `ping` sí responde), es casi siempre esto. En
> Linux con `ufw` activo (`sudo ufw status`), abrí el puerto del servidor:
> ```bash
> sudo ufw allow 8787/tcp     # o el puerto que hayas puesto en PORT/.env
> ```
> Verificá con `sudo ufw status verbose` que la regla quedó activa, y
> probá de nuevo desde la otra máquina.

### Compilar un binario standalone para otra máquina (`make compile`)

Para probar la CLI en otra VM/PC sin Node ni npm instalados, generá un
binario único con la URL del servidor ya embebida:

```bash
make compile
```

Te pregunta si querés configurar la URL para este build (si decís que no,
el binario queda con la URL de producción por defecto). Si decís que sí:

- Te propone la IP de red detectada de tu PC (o la que vos escribas) y el
  puerto (`PORT` del `.env`, o `8787`).
- Lee `CLIENT_TOKEN` de `worker/.env` si existe.
- Genera `cli/dist-bin/lexema-linux-x64` con esa URL/token **ya embebidos
  como default** dentro del propio binario (igual que el workflow de
  releases inyecta el token compartido) — no hace falta copiar ningún
  archivo de configuración aparte para que funcione.

En la otra máquina, **solo copiás la carpeta `cli/dist-bin/` completa**
(incluye un `config.json` de respaldo, por si querés reapuntar el mismo
binario a otro servidor sin recompilar) y corrés:

```bash
chmod +x lexema-linux-x64
./lexema-linux-x64 chat
```

Si esa otra máquina no ve la URL/puerto que acabás de configurar, revisá:

- Que no tenga ya un `~/.lexema/config.json` viejo (un `config set-url`
  anterior siempre gana sobre el default embebido en el binario).
- Si la copiaste vía una carpeta compartida de VirtualBox, que el archivo
  no haya quedado en caché: compará `sha256sum lexema-linux-x64` en el
  host y en la VM; si difieren, remontá la carpeta compartida
  (`sudo umount` + `sudo mount -t vboxsf ...`) o reiniciá la VM.
- El firewall del host (ver el aviso de arriba).

### Configuración vía `.env`

Copia `worker/.env.example` → `worker/.env` y edita lo que necesites.
Distribuir el servidor es literalmente repartir ese archivo:

| Variable | Descripción |
|---|---|
| `AI_PROVIDER` | `gemini` \| `openai` \| `openrouter` \| `groq`. Sin definir: autodetecta por la key presente |
| `AI_API_KEY` | Clave genérica. O usa la específica: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY` |
| `AI_BASE_URL` | Endpoint base (se autodetecta por proveedor; útil para LLMs locales) |
| `AI_DEFAULT_MODEL` | Modelo por defecto si la CLI no envía `-m` |
| `AI_ALLOWED_MODELS` | Lista blanca `m1,m2`. Vacía = sin restricción |
| `SYSTEM_PROMPT` | Instrucción de sistema que se antepone a cada prompt |
| `CLIENT_TOKEN` | Bearer token que exige el endpoint (muy recomendado) |
| `MAX_PROMPT_LENGTH` | Límite de caracteres del prompt (default 4000) |
| `DAILY_LIMIT` | Peticiones por IP por día (default 100) |
| `PORT` | Solo servidor local (default 8787) |

El servidor local carga `.dev.vars` y luego `.env` (este último gana);
`ENV_FILE=otro-archivo` para apuntar a otro. Endpoints expuestos:
`POST /` (chat), `GET /models`, `GET /health`.

## 2. Desplegar el Worker (producción)

```bash
cd worker
npm install
npx wrangler login          # abre el navegador y autoriza tu cuenta de Cloudflare

# Secretos (no se guardan en el código):
npx wrangler secret put AI_API_KEY       # (o GEMINI_API_KEY / OPENROUTER_API_KEY)
npx wrangler secret put CLIENT_TOKEN
# inventa un token largo y aleatorio: openssl rand -hex 32
# Este token protege tu Worker de que cualquiera lo use y gaste tu cuota.
#
# Importante: si pegas el token con un pipe (`$token | wrangler secret put ...`)
# en PowerShell, se le puede colar un salto de línea al final y el token dejará
# de coincidir con el que guardes en la CLI. Usa el prompt interactivo de
# `wrangler secret put` (pégalo a mano) o, en bash, `printf '%s' "$TOKEN" | wrangler secret put CLIENT_TOKEN`.

# Configuración no-secreta (proveedor, modelos, límites) en wrangler.toml:
#   [vars]
#   AI_PROVIDER = "openrouter"
#   AI_DEFAULT_MODEL = "openrouter/auto"

npm run deploy
```

Al terminar, `wrangler` te dará una URL como:

```
https://lexema-api.<tu-subdominio>.workers.dev
```

Guárdala, la necesitas para configurar la CLI.

### (Opcional pero recomendado) Rate limiting por IP

Un token compartido dentro de un binario público **se puede extraer** por un
usuario con conocimientos técnicos, así que no es una protección perfecta.
Para un límite adicional, activa Workers KV:

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

Copia el `id` que te devuelve y descomenta el bloque `[[kv_namespaces]]` en
`worker/wrangler.toml`, luego vuelve a correr `npm run deploy`. Con esto,
cada IP queda limitada a `DAILY_LIMIT` peticiones por día.

## 3. Configurar y probar la CLI en local

```bash
cd cli
npm install
npm run build

node dist/index.js config set-url https://lexema-api.<tu-subdominio>.workers.dev
node dist/index.js config set-token EL_MISMO_TOKEN_QUE_PUSISTE_EN_CLIENT_TOKEN

node dist/index.js ask "Hola, preséntate en una línea"
node dist/index.js chat
node dist/index.js models
```

Si todo responde bien, ya tienes el flujo completo funcionando.

## 4. Publicar el código en GitHub

```bash
cd ..   # raíz del repo
git add .
git commit -m "Lexema CLI inicial"
git branch -M main
git remote add origin https://github.com/diegoabdo/lexema-cli.git
git push -u origin main
```

> El Worker (`worker/`) puede vivir en el mismo repo (como aquí) o en uno
> aparte; no afecta el resto de la guía.

## 5. Publicar binarios automáticamente (GitHub Actions)

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

## 6. Publicar el instalador en tu propio dominio (opcional)

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
| `lexema ask "<prompt>"` | Pregunta puntual (opción `-m <modelo>`) |
| `lexema chat` | Sesión interactiva (escribe "exit" para terminar) |
| `lexema models` | Lista proveedor, modelo por defecto y modelos permitidos |
| `lexema config show` | Ver configuración actual |
| `lexema config set-url <url>` | Cambiar la URL del Worker |
| `lexema config set-token <token>` | Guardar el token de autenticación |
| `lexema config set-model <modelo>` | Fijar un modelo por defecto |

La configuración se guarda en `~/.lexema/config.json`.

## Comandos de desarrollo (Makefile)

| Target | Descripción |
|---|---|
| `make install` | Instala dependencias de `cli/` y `worker/` |
| `make env` | Crea `worker/.env` desde `.env.example` |
| `make up` | Levanta el servidor local + chat; al salir detiene todo |
| `make server` | Solo el servidor local (`:8787`) |
| `make use-lan` | Detecta IPs de red y apunta la CLI a una de ellas (probar desde otro dispositivo) |
| `make compile` | Genera `cli/dist-bin/lexema-linux-x64`, binario standalone con URL/token embebidos |
| `make test` | Tipos + smoke test + demo (mocks, sin claves reales) |
| `make ask P="..."` / `make chat` / `make models` | Atajos de la CLI |
| `make typecheck` / `make build` / `make clean` | Tipos, compilar, limpiar |
| `make deploy` | Publica el worker en Cloudflare |

## Siguientes pasos sugeridos (no incluidos todavía)

- **Streaming de respuestas** (los proveedores lo soportan vía SSE)
  para que el texto aparezca palabra por palabra en vez de esperar la
  respuesta completa.
- **BYOK (Bring Your Own Key)**: dejar que cada usuario ponga su propia
  clave con `lexema config set-key`, para no depender de tu cuota
  compartida a medida que crezca el uso.
- **Homebrew tap / Scoop manifest** para instalación más nativa en
  macOS/Windows, como alternativa a los scripts `curl | bash`.
