#!/usr/bin/env node
// select-lan-ip.mjs — detecta las IPs de red de esta máquina y deja elegir
// cuál debe usar la CLI, evitando un `config set-url` manual cuando querés
// probar la CLI desde otro dispositivo de tu LAN (móvil, otra laptop...)
// apuntando al worker local.
//
// Uso: node scripts/select-lan-ip.mjs   (o "make use-lan")

import { networkInterfaces } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, 'worker', '.env');
const CLI_ENTRY = path.join(ROOT, 'cli', 'dist', 'index.mjs');

function readEnvVar(name) {
  if (!existsSync(ENV_FILE)) return undefined;
  const line = readFileSync(ENV_FILE, 'utf-8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  if (!line) return undefined;
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

function listCandidateIPs() {
  const ifaces = networkInterfaces();
  const candidates = [{ label: 'localhost (solo esta máquina)', ip: 'localhost' }];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push({ label: `${name} (${addr.address})`, ip: addr.address });
      }
    }
  }
  return candidates;
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim();
}

function run(args) {
  const res = spawnSync('node', [CLI_ENTRY, ...args], { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

async function main() {
  if (!existsSync(CLI_ENTRY)) {
    console.error('Falta cli/dist. Corre "make build" primero (o "make use-lan" ya lo hace).');
    process.exit(1);
  }

  const port = readEnvVar('PORT') || '8787';
  const token = readEnvVar('CLIENT_TOKEN');
  const candidates = listCandidateIPs();

  console.log('IPs detectadas en esta máquina:\n');
  candidates.forEach((c, i) => console.log(`  ${i + 1}) ${c.label}`));
  console.log('');

  const raw = await ask(`Elegí cuál debe usar la CLI [1-${candidates.length}] (default 1): `);
  const idx = raw ? parseInt(raw, 10) - 1 : 0;
  const chosen = candidates[idx];
  if (!chosen) {
    console.error(`Opción inválida: "${raw}"`);
    process.exit(1);
  }

  const url = `http://${chosen.ip}:${port}`;
  run(['config', 'set-url', url]);
  if (token) run(['config', 'set-token', token]);

  console.log(`\n✔ CLI apuntando a ${url}${chosen.ip === 'localhost' ? '' : ' (accesible desde otros dispositivos de tu LAN)'}`);
}

main();
