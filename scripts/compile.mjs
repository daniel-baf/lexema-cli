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

async function main() {
  console.log('Compilando binario standalone de la CLI (cli/dist-bin)...\n');
  run('npm', ['run', 'compile'], { cwd: CLI_DIR });

  const skip = (await ask('\n¿Configurar la URL del servidor para este build? [S/n]: ')).toLowerCase();
  if (skip === 'n' || skip === 'no') {
    console.log('\nOmitido. El binario usa la URL por defecto (worker de producción).');
    console.log(`Listo: ${path.relative(ROOT, DIST_BIN)}/`);
    return;
  }

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

  const config = { workerUrl: `http://${ip}:${port}` };
  if (token) config.token = token;

  writeFileSync(OUT_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  console.log(`\n✔ Binario en ${path.relative(ROOT, DIST_BIN)}/lexema-linux-x64`);
  console.log(`✔ Config en ${path.relative(ROOT, OUT_CONFIG)} → ${config.workerUrl}`);
  console.log('\nEn la otra VM: copiá ambos archivos, luego:');
  console.log('  mkdir -p ~/.lexema && cp config.json ~/.lexema/config.json');
  console.log('  chmod +x lexema-linux-x64 && ./lexema-linux-x64 chat');
}

main().finally(() => rl.close());
