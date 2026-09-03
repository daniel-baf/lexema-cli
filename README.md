# Lexema CLI

CLI de IA para la terminal (`lexema ask`, `lexema chat`), con un servidor
propio (Node puro) como proxy que oculta tu clave de API. El proveedor de
IA es **agnóstico**: OpenRouter, OpenAI, Groq o cualquier endpoint
compatible con la API de OpenAI (`/chat/completions`) — todo se configura
con variables de entorno. Corre en
cualquier VM/servidor con Node, sin depender de ningún proveedor serverless.

```
lexema-cli/
├── cli/            # El paquete de la CLI (TypeScript -> binario)
├── worker/         # Servidor (Node) — proxy hacia la IA
├── scripts/        # Scripts de utilidad (SCREAM): up, smoke-test, demo, compile
├── Makefile        # Comandos de desarrollo: make install, env, up, test...
└── .github/workflows/ci.yml   # CI: typecheck + lint + tests
```

## 0. Requisitos

- Node.js 18+ y npm.
- Una API key de cualquier proveedor soportado:
  - [OpenRouter](https://openrouter.ai/keys), OpenAI, Groq, ... o un LLM local
- Para producción: una VM/servidor donde correr `worker/` con Node (por
  ejemplo una instancia e2-micro de GCP, o cualquier otra).

## 1. Probar en local

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

### Compilar binarios standalone para otra máquina (`make compile`)

Para probar la CLI en otra VM/PC sin Node ni npm instalados, generá
binarios con la URL del servidor ya embebida. Primero definí `SERVER_HOST`
en `worker/.env` (ver la tabla de variables más abajo) con la IP o dominio
del servidor:

```bash
# worker/.env
SERVER_HOST=192.168.1.50
PORT=8787
```

```bash
make compile
```

Sin preguntas interactivas: arma la URL como `http://SERVER_HOST:PORT`,
lee `CLIENT_TOKEN` de `worker/.env` si existe, y genera en
`cli/dist-bin/` tres binarios con esa URL/token **ya embebidos como
default** — no hace falta copiar ningún archivo de configuración aparte:

- `lexema-linux-x64`
- `lexema-linux-arm64`
- `lexema-windows-x64.exe`

(Bun, el compilador usado acá, no soporta targets de 32 bits — solo
x64/arm64. Para dispositivos ARM de 64 bits, como Raspberry Pi de 64 bits,
usá el binario `arm64`.)

En la otra máquina, **solo copiás la carpeta `cli/dist-bin/` completa**
(incluye un `config.json` de respaldo, por si querés reapuntar el mismo
binario a otro servidor sin recompilar) y corrés:

```bash
# Linux
chmod +x lexema-linux-x64
./lexema-linux-x64 chat

# Windows
lexema-windows-x64.exe chat
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
| `AI_PROVIDER` | `openai` \| `openrouter` \| `groq`. Sin definir: `openai` |
| `AI_API_KEY` | Clave genérica. O usa la específica: `OPENROUTER_API_KEY`, `OPENAI_API_KEY` |
| `AI_BASE_URL` | Endpoint base (se autodetecta por proveedor; útil para LLMs locales) |
| `AI_DEFAULT_MODEL` | Modelo por defecto si la CLI no envía `-m` |
| `AI_ALLOWED_MODELS` | Lista blanca `m1,m2`. Vacía = sin restricción |
| `SYSTEM_PROMPT` | Instrucción de sistema que se antepone a cada prompt |
| `CLIENT_TOKEN` | Bearer token que exige el endpoint (muy recomendado) |
| `MAX_PROMPT_LENGTH` | Límite de caracteres del prompt (default 4000) |
| `DAILY_LIMIT` | Peticiones por IP por día (default 100) |
| `PORT` | Solo servidor local (default 8787) |
| `UPDATE_FILE` | Fuerza el archivo que sirve `GET /download` (updater) |
| `INSTALL_FILE` | Binario de la CLI que sirve `GET /install` (default `cli/dist-bin/lexema-linux-x64`) |
| `SERVER_HOST` | Solo `make compile`: IP/dominio del servidor que se embebe como default en los binarios standalone |

El servidor local carga `.dev.vars` y luego `.env` (este último gana);
`ENV_FILE=otro-archivo` para apuntar a otro. Endpoints expuestos:
`POST /` (chat), `GET /models`, `GET /health`, `GET /download` (updater)
y `GET /install` (instalador de la CLI).

### Instalar la CLI desde el servidor (curl | sh)

Si en la VM hay un binario compilado (`make compile` genera
`cli/dist-bin/lexema-linux-x64`, o apunta `INSTALL_FILE` a donde hayas
subido el ejecutable), cualquier máquina lo instala con un comando:

```bash
# Sin CLIENT_TOKEN:
curl -fsSL http://<ip-vm>:8787/install | sh

# Con CLIENT_TOKEN (el token viaja en el curl; el script ya lo lleva embebido):
curl -fsSL -H "Authorization: Bearer $TOKEN" http://<ip-vm>:8787/install | sh
```

`GET /install` devuelve un script sh generado al vuelo (con la URL del
servidor y el token embebidos) que descarga el binario de
`GET /install/binary` y lo deja en `/usr/local/bin/lexema` (con `sudo` si
hace falta). Si no hay binario compilado, responde 404 con instrucciones.

## 2. Correr el servidor en producción (tu propia VM)

No hay ningún proveedor serverless de por medio: `worker/` es un servidor
Node normal, así que en producción se corre igual que en local, en la VM
que elijas.

```bash
# En la VM
git clone <tu-fork>
cd lexema-cli
make install
make env
$EDITOR worker/.env   # proveedor, API key y un CLIENT_TOKEN largo y aleatorio
                       # (generalo con: openssl rand -hex 32)
make server            # o corré worker/ detrás de systemd/pm2/tmux para que persista
```

Guardá la IP/dominio de la VM y el `CLIENT_TOKEN`, los necesitás para
configurar la CLI (`config set-url` / `config set-token`, o compilá un
binario ya apuntado con `make compile`, ver arriba).

### Rate limiting por IP

El servidor ya trae rate limiting en memoria (no persiste reinicios):
cada IP queda limitada a `DAILY_LIMIT` peticiones por día. No requiere
configuración aparte, solo definir `DAILY_LIMIT` en `worker/.env` si el
default (100) no te sirve. Un token compartido dentro de un binario
público **se puede extraer** por un usuario con conocimientos técnicos,
así que `CLIENT_TOKEN` + `DAILY_LIMIT` combinados no son una protección
perfecta, pero sí un límite razonable de abuso.

## 3. Configurar y probar la CLI en local

```bash
cd cli
npm install
npm run build

node dist/index.js config set-url http://<ip-o-dominio-de-tu-servidor>:8787
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

> El servidor (`worker/`) puede vivir en el mismo repo (como aquí) o en uno
> aparte; no afecta el resto de la guía.

## 5. Distribuir la CLI desde tu propio servidor (GET /install)

La distribución es autoalojada: el mismo server sirve los binarios que
compila `make compile` y genera el instalador según el OS de quien la pida.

```bash
# Linux (autodetecta x64/arm64)
curl -fsSL http://<ip-servidor>:8787/install | sh

# Windows (PowerShell, sin admin)
irm http://<ip-servidor>:8787/install.ps1 | iex
```

Qué hace cada pieza:

| Endpoint | Qué entrega |
|---|---|
| `GET /install` (alias `/install.sh`) | Script sh generado al vuelo: detecta `uname` (linux-x64 / linux-arm64), baja el binario y lo deja en `/usr/local/bin/lexema` (con `sudo` si hace falta) |
| `GET /install.ps1` | Script PowerShell: baja `lexema.exe` a `%LOCALAPPDATA%\Programs\lexema` y lo agrega al PATH de usuario |
| `GET /install/binary?os=` | El binario en crudo (`linux-x64`, `linux-arm64`, `windows-x64`) |

Detalles:

- Si hay `CLIENT_TOKEN` en el server, el curl necesita el header
  (`-H "Authorization: Bearer <token>"` en Linux, `-Headers @{Authorization='Bearer <token>'}`
  en PowerShell), pero el script ya lleva el token embebido para la descarga
  del binario: un solo comando instala todo funcionando.
- Sin binario compilado, los endpoints responden 404 con instrucciones.
- El log de arranque del server muestra qué binarios tiene disponibles por OS
  (`Instalador CLI (linux-x64): ...`).
- `INSTALL_FILE` en el `.env` fuerza un único archivo para todos los OS
  (útil si subís un ejecutable compilado a una ruta cualquiera de la VM).

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
| `lexema config set-url <url>` | Cambiar la URL del servidor |
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
| `make compile` | Genera binarios standalone (linux-x64, linux-arm64, windows-x64) con URL/token embebidos, desde `SERVER_HOST`/`PORT`/`CLIENT_TOKEN` de `worker/.env` |
| `make test` | Tipos + smoke test + demo (mocks, sin claves reales) |
| `make ask P="..."` / `make chat` / `make models` | Atajos de la CLI |
| `make typecheck` / `make build` / `make clean` | Tipos, compilar, limpiar |

## Siguientes pasos sugeridos (no incluidos todavía)

- **Streaming de respuestas** (los proveedores lo soportan vía SSE)
  para que el texto aparezca palabra por palabra en vez de esperar la
  respuesta completa.
- **BYOK (Bring Your Own Key)**: dejar que cada usuario ponga su propia
  clave con `lexema config set-key`, para no depender de tu cuota
  compartida a medida que crezca el uso.
- **Homebrew tap / Scoop manifest** para instalación más nativa en
  macOS/Windows, como alternativa a los scripts `curl | bash`.
