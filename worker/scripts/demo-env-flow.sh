#!/usr/bin/env bash
set -u
# Demo del flujo canónico: TODO sale de worker/.env, nada de variables inline.
WORKER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$(cd "$WORKER_DIR/../cli" && pwd)"
cd "$WORKER_DIR"

node -e '
const http = require("http");
http.createServer((req,res)=>{let b="";req.on("data",c=>b+=c);req.on("end",()=>{
  if(!req.url.includes("/chat/completions")){res.writeHead(404);return res.end();}
  const body=JSON.parse(b||"{}");
  res.writeHead(200,{"Content-Type":"application/json"});
  res.end(JSON.stringify({choices:[{message:{content:"Mock dice: "+body.messages[body.messages.length-1].content}}]}));
});}).listen(4599);' &
MOCK=$!

cp .env.example .env
cat >> .env <<'EOF'
AI_PROVIDER=openrouter
AI_BASE_URL=http://localhost:4599/v1
AI_API_KEY=demo-key
CLIENT_TOKEN=demo-token
EOF

npm run dev:node > /tmp/lexema-env-demo.log 2>&1 &
DEV=$!
sleep 3

echo "=== startup log (config leida del .env) ==="; cat /tmp/lexema-env-demo.log
echo "=== health ==="; curl -s http://localhost:8787/health
echo; echo "=== ask via CLI (HOME aislado) ==="
export HOME=/tmp/lexema-env-demo-home; rm -rf "$HOME"; mkdir -p "$HOME"
cd "$CLI_DIR"
node dist/index.js config set-url http://localhost:8787 > /dev/null
node dist/index.js config set-token demo-token > /dev/null
node dist/index.js ask "prueba del .env"

kill $DEV $MOCK 2>/dev/null
rm -f "$WORKER_DIR/.env"
echo; echo DEMO_DONE
