#!/usr/bin/env bash
# make up — levanta el servidor local de pruebas y abre el chat.
# Al salir del chat (o Ctrl-C) el servidor se detiene solo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/worker/.env"
SERVER_LOG="${LEXEMA_SERVER_LOG:-/tmp/lexema-up-server.log}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Falta worker/.env. Corre primero: make env  (y edita proveedor + API key)"
  exit 1
fi

# Config leída del .env: puerto y token compartido
PORT=$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || true)
PORT=${PORT:-8787}
BASE_URL="http://localhost:$PORT"
TOKEN=$(grep -E '^CLIENT_TOKEN=' "$ENV_FILE" | cut -d= -f2 || true)

if curl -sf "$BASE_URL/health" > /dev/null 2>&1; then
  echo "→ Ya hay un servidor corriendo en $BASE_URL (se reutiliza)"
else
  echo "→ Compilando CLI..."
  (cd cli && npm run build > /dev/null)
  echo "→ Levantando servidor en $BASE_URL (log: $SERVER_LOG)..."
  (
    cd worker
    exec ./node_modules/.bin/tsx src/server.ts > "$SERVER_LOG" 2>&1
  ) &
  SERVER_PID=$!
  cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
  trap cleanup EXIT INT TERM

  for _ in $(seq 1 40); do
    curl -sf "$BASE_URL/health" > /dev/null 2>&1 && break
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "✖ El servidor murió al arrancar. Últimas líneas del log:"
      tail -20 "$SERVER_LOG"
      exit 1
    fi
    sleep 0.5
  done
  curl -sf "$BASE_URL/health" > /dev/null || { echo "✖ El servidor no respondió a tiempo"; tail -20 "$SERVER_LOG"; exit 1; }
fi

echo "→ Apuntando la CLI a $BASE_URL"
node cli/dist/index.js config set-url "$BASE_URL" > /dev/null
if [ -n "$TOKEN" ]; then
  node cli/dist/index.js config set-token "$TOKEN" > /dev/null
fi

echo "→ Listo. Escribe \"exit\" para salir del chat."
node cli/dist/index.js chat
