#!/usr/bin/env node
// compile.mjs — compila el binario standalone de la CLI (cli/dist-bin) para
// Linux (x64 + arm64) y Windows (x64), apuntado al servidor definido en
// worker/.env (SERVER_HOST + PORT), sin preguntas interactivas ni URLs
// hardcodeadas de ningún worker.
//
// Uso: node scripts/compile.mjs   (o "make compile")

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = path.join(ROOT, 'cli');
const ENV_FILE = path.join(ROOT, 'worker', '.env');
const DIST_BIN = path.join(CLI_DIR, 'dist-bin');
const OUT_CONFIG = path.join(DIST_BIN, 'config.json');
const BUNDLE = path.join(CLI_DIR, 'dist', 'index.mjs');

// Bun no soporta targets de 32 bits para "bun build --compile" (solo
// x64/arm64). Si necesitás 32 bits hablamos de otra estrategia (pkg, etc).
const TARGETS = [
  { bunTarget: 'bun-linux-x64', outfile: 'lexema-linux-x64' },
  { bunTarget: 'bun-linux-arm64', outfile: 'lexema-linux-arm64' },
  { bunTarget: 'bun-windows-x64', outfile: 'lexema-windows-x64.exe' },
];

function readEnvVar(name) {
  if (!existsSync(ENV_FILE)) return undefined;
  const line = readFileSync(ENV_FILE, 'utf-8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  if (!line) return undefined;
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const URL_MARKER = 'workerUrl: "http://localhost:8787"';
const TOKEN_MARKER = 'DEFAULT_CLIENT_TOKEN = ""';

// Reemplaza el default del bundle ya compilado (igual que scripts/inject-token.js
// hace con el token): así el binario standalone queda funcionando con solo
// copiarlo, sin depender de que alguien copie también config.json a la otra VM.
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

function main() {
  console.log('Compilando binario standalone de la CLI (cli/dist-bin)...\n');

  const host = readEnvVar('SERVER_HOST');
  if (!host) {
    console.error(
      'Falta SERVER_HOST en worker/.env. Definí ahí la IP/dominio del servidor ' +
        '(ver worker/.env.example) y volvé a correr "make compile".'
    );
    process.exit(1);
  }
  const port = readEnvVar('PORT') || '8787';
  const token = readEnvVar('CLIENT_TOKEN');
  const workerUrl = `http://${host}:${port}`;

  console.log('Compilando bundle (esbuild)...');
  run('npm', ['run', 'build'], { cwd: CLI_DIR });

  injectDefaults(workerUrl, token);

  mkdirSync(DIST_BIN, { recursive: true });

  console.log('\nGenerando binarios standalone (bun compile)...');
  for (const { bunTarget, outfile } of TARGETS) {
    console.log(`  → ${outfile} (${bunTarget})`);
    run(
      'bun',
      [
        'build',
        '--compile',
        `--target=${bunTarget}`,
        'dist/index.mjs',
        '--outfile',
        `dist-bin/${outfile}`,
      ],
      { cwd: CLI_DIR }
    );
  }

  // config.json queda además como respaldo por si alguien quiere apuntar el
  // mismo binario a otro servidor sin recompilar (lexema config set-url).
  const config = { workerUrl };
  if (token) config.token = token;
  writeFileSync(OUT_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  console.log(`\n✔ Binarios en ${path.relative(ROOT, DIST_BIN)}/ → ${workerUrl} (default embebido)`);
  console.log(`✔ Config de respaldo en ${path.relative(ROOT, OUT_CONFIG)}`);
  console.log('\nEn la otra máquina: copiá la carpeta dist-bin/ completa y listo:');
  console.log('  Linux:   chmod +x lexema-linux-x64 && ./lexema-linux-x64 chat');
  console.log('  Windows: lexema-windows-x64.exe chat');
}

main();
