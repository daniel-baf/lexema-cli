#!/usr/bin/env bash
set -u
WORKER_DIR="$(cd "$(dirname "$0")/../worker" && pwd)"
cd "$WORKER_DIR"

node -e '
const http = require("http");
http.createServer((req,res)=>{let b="";req.on("data",c=>b+=c);req.on("end",()=>{
  if(!req.url.includes("/chat/completions")){res.writeHead(404);return res.end();}
  if((req.headers.authorization||"")!=="Bearer mock-key"){res.writeHead(401);return res.end("{\"error\":{\"message\":\"bad key\"}}");}
  const body=JSON.parse(b||"{}");
  res.writeHead(200,{"Content-Type":"application/json"});
  res.end(JSON.stringify({choices:[{message:{content:"MOCK-REPLY("+body.model+"): "+(body.messages[body.messages.length-1].content)}}]}));
});}).listen(4599);' &
MOCK_OAI=$!

cat > .env.test <<'EOF'
AI_PROVIDER=openai
AI_API_KEY=mock-key
AI_BASE_URL=http://localhost:4599/v1
AI_DEFAULT_MODEL=test-model
CLIENT_TOKEN=test-token
MAX_PROMPT_LENGTH=50
DAILY_LIMIT=3
EOF

ENV_FILE="$WORKER_DIR/.env.test" PORT=8787 npm run dev > /tmp/lexema-dev.log 2>&1 &
DEV=$!
sleep 3
echo "=== startup log ==="; cat /tmp/lexema-dev.log
echo "=== health ==="; curl -s http://localhost:8787/health
echo; echo "=== models ==="; curl -s http://localhost:8787/models
echo; echo "=== POST sin token (401 esperado) ==="; curl -s -w ' [%{http_code}]' -X POST http://localhost:8787/ -H 'Content-Type: application/json' -d '{"prompt":"hola"}'
echo; echo "=== POST con token ==="; curl -s -X POST http://localhost:8787/ -H 'Content-Type: application/json' -H 'Authorization: Bearer test-token' -d '{"prompt":"hola que tal"}'
echo; echo "=== POST con model custom ==="; curl -s -X POST http://localhost:8787/ -H 'Content-Type: application/json' -H 'Authorization: Bearer test-token' -d '{"prompt":"hola","model":"mi-modelo"}'
echo; echo "=== POST prompt largo (400 esperado) ==="; curl -s -w ' [%{http_code}]' -X POST http://localhost:8787/ -H 'Content-Type: application/json' -H 'Authorization: Bearer test-token' -d '{"prompt":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
echo; echo "=== POST 4/4 (429 esperado) ==="; curl -s -w ' [%{http_code}]' -X POST http://localhost:8787/ -H 'Content-Type: application/json' -H 'Authorization: Bearer test-token' -d '{"prompt":"uno mas"}'
echo; echo "=== GET raiz (405 esperado) ==="; curl -s -w ' [%{http_code}]' http://localhost:8787/

ENV_FILE=/dev/null AI_PROVIDER=groq AI_API_KEY=mock-key AI_BASE_URL=http://localhost:4599/v1 PORT=8788 npx tsx src/server.ts > /tmp/lexema-dev2.log 2>&1 &
DEV2=$!
sleep 3
echo; echo "=== alias groq health/models ==="; curl -s http://localhost:8788/health; echo; curl -s http://localhost:8788/models
echo; echo "=== alias groq POST ==="; curl -s -X POST http://localhost:8788/ -H 'Content-Type: application/json' -d '{"prompt":"hola groq"}'

ENV_FILE=/dev/null AI_PROVIDER=openrouter PORT=8789 npx tsx src/server.ts > /tmp/lexema-dev3.log 2>&1 &
DEV3=$!
sleep 3
echo; echo "=== openrouter sin key (500 esperado) ==="; curl -s -w ' [%{http_code}]' -X POST http://localhost:8789/ -H 'Content-Type: application/json' -d '{"prompt":"x"}'

kill $DEV $DEV2 $DEV3 $MOCK_OAI 2>/dev/null
rm -f "$WORKER_DIR/.env.test"
echo; echo DONE
