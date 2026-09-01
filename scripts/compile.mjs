#!/usr/bin/env node
// compile.mjs — compila el binario standalone de la CLI (cli/dist-bin) y arma
// un config.json listo para copiar a otra VM: pregunta la IP (autodetectada y
// propuesta, o la que vos ingreses) y el puerto del worker.
//
// Uso: node scripts/compile.mjs   (o "make compile")

import { networkInterfaces } from 'node:os';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = path.join(ROOT, 'cli');
const ENV_FILE = path.join(ROOT, 'worker', '.env');
const DIST_BIN = path.join(CLI_DIR, 'dist-bin');
const OUT_CONFIG = path.join(DIST_BIN, 'config.json');

function readEnvVar(name) {
  if (!existsSync(ENV_FILE)) return undefined;
  const line = readFileSync(ENV_FILE, 'utf-8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  if (!line) return undefined;
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

function detectLanIP() {
  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return undefined;
}

// Iterador asíncrono en vez de rl.question() encadenado: question()+once('line')
// pierde líneas cuando el build tarda lo suficiente como para que varias
// respuestas ya estén bufferizadas en stdin al mismo tiempo.
const rl = readline.createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();

async function ask(question) {
  process.stdout.write(question);
  const { value } = await lines.next();
  return (value ?? '').trim();
}

async function askWithDefault(question, def) {
  const raw = await ask(`${question}${def ? ` [${def}]` : ''}: `);
  return raw || def;
}

function run(cmd, args, opts = {}) {
  // stdin en 'ignore': estos subprocesos (npm/bun) no deben tocar el stdin
  // interactivo que usamos para las preguntas de este script.
  const res = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const BUNDLE = path.join(CLI_DIR, 'dist', 'index.mjs');
const URL_MARKER = 'workerUrl: "https://lexema-api.diego12.workers.dev"';
const TOKEN_MARKER = 'DEFAULT_CLIENT_TOKEN = ""';

// Reemplaza el default hardcodeado (workerUrl de producción) en el bundle ya
// compilado, igual que scripts/inject-token.js hace con el token: así el
// binario standalone queda funcionando con solo copiarlo, sin depender de que
// alguien copie también config.json a ~/.lexema en la otra máquina.
function injectDefaults(workerUrl, token) {
  let content = readFileSync(BUNDLE, 'utf-8');
  if (!content.includes(URL_MARKER)) {
    throw new Error(`No se encontró el marcador de workerUrl en ${BUNDLE}. ¿Cambió cli/src/config.ts?`);
  }
  content = content.replace(URL_MARKER, `workerUrl: ${JSON.stringify(workerUrl)}`);
  if (token && content.includes(TOKEN_MARKER)) {
    content = content.replace(TOKEN_MARKER, `DEFAULT_CLIENT_TOKEN = ${JSON.stringify(token)}`);
  }
  writeFileSync(BUNDLE, content, 'utf-8');
}

async function main() {
  console.log('Compilando binario standalone de la CLI (cli/dist-bin)...\n');

  const skip = (await ask('¿Configurar la URL del servidor para este build? [S/n]: ')).toLowerCase();

  let config = null;
  if (skip !== 'n' && skip !== 'no') {
    const detected = detectLanIP();
    let ip;
    if (detected) {
      const useIt = (await ask(`IP detectada: ${detected}. ¿Usarla? [S/n]: `)).toLowerCase();
      ip = useIt === 'n' || useIt === 'no' ? await ask('Ingresá la IP a usar: ') : detected;
    } else {
      console.log('No se detectó ninguna IP de red (solo localhost).');
      ip = await askWithDefault('Ingresá la IP a usar', 'localhost');
    }

    const defaultPort = readEnvVar('PORT') || '8787';
    const port = await askWithDefault('Puerto del worker', defaultPort);
    const token = readEnvVar('CLIENT_TOKEN');

    config = { workerUrl: `http://${ip}:${port}` };
    if (token) config.token = token;
  }

  console.log('\nCompilando bundle (esbuild)...');
  run('npm', ['run', 'build'], { cwd: CLI_DIR });

  if (config) {
    injectDefaults(config.workerUrl, config.token);
  }

  console.log('Generando binario standalone (bun compile)...');
  run('bun', ['build', '--compile', 'dist/index.mjs', '--outfile', 'dist-bin/lexema-linux-x64'], {
    cwd: CLI_DIR,
  });

  if (!config) {
    console.log('\nOmitido. El binario usa la URL por defecto (worker de producción).');
    console.log(`Listo: ${path.relative(ROOT, DIST_BIN)}/`);
    return;
  }

  // config.json queda además como respaldo por si alguien quiere apuntar el
  // mismo binario a otro servidor sin recompilar (lexema config set-url).
  writeFileSync(OUT_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  console.log(`\n✔ Binario en ${path.relative(ROOT, DIST_BIN)}/lexema-linux-x64 → ${config.workerUrl} (default embebido)`);
  console.log(`✔ Config de respaldo en ${path.relative(ROOT, OUT_CONFIG)}`);
  console.log('\nEn la otra VM: copiá la carpeta dist-bin/ completa y listo:');
  console.log('  chmod +x lexema-linux-x64 && ./lexema-linux-x64 chat');
}

main().finally(() => rl.close());
