#!/usr/bin/env node
import { Command } from 'commander';
import axios, { AxiosError } from 'axios';
import inquirer from 'inquirer';
import pc from 'picocolors';
import { loadConfig, saveConfig } from './config';

const VERSION = '1.0.2'; // mantenla en sincronía con package.json

const program = new Command();

program
  .name('lexema')
  .description('CLI oficial de Lexema Labs para IA en la terminal')
  .version(VERSION);

interface WorkerResponse {
  reply?: string;
  error?: string;
}

async function callWorker(prompt: string, model?: string): Promise<string> {
  const config = loadConfig();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  const res = await axios.post<WorkerResponse>(
    config.workerUrl,
    { prompt, model: model || config.model },
    { headers, timeout: 30000 }
  );

  if (!res.data.reply) {
    throw new Error(res.data.error || 'Respuesta vacía del servidor.');
  }
  return res.data.reply;
}

function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError<WorkerResponse>;
    if (err.response) {
      const msg = err.response.data?.error || err.message;
      return `Error del servidor (${err.response.status}): ${msg}`;
    }
    if (err.code === 'ECONNABORTED') return 'Tiempo de espera agotado. Intenta de nuevo.';
    return `No se pudo conectar con Lexema Labs (${err.message}). Revisa tu conexión o "lexema config show".`;
  }
  if (error instanceof Error) return error.message;
  return 'Error inesperado.';
}

program
  .command('ask')
  .argument('<prompt>', 'Pregunta o instrucción para la IA')
  .option('-m, --model <model>', 'Modelo a usar (opcional)')
  .description('Realiza una consulta rápida a la IA')
  .action(async (prompt: string, opts: { model?: string }) => {
    process.stdout.write(pc.dim('Pensando... '));
    try {
      const reply = await callWorker(prompt, opts.model);
      console.log('\r' + pc.green('✔ Lexema: ') + reply + '\n');
    } catch (error) {
      console.log('\r' + pc.red('✖ ') + describeError(error));
      process.exitCode = 1;
    }
  });

program
  .command('chat')
  .description('Inicia una sesión interactiva de conversación')
  .action(async () => {
    console.log(pc.bold(pc.cyan('\n─── Sesión Interactiva de Lexema (escribe "exit" para salir) ───\n')));

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { input } = await inquirer.prompt([
        { type: 'input', name: 'input', message: pc.green('you >') },
      ]);

      const trimmed = String(input).trim();
      const lower = trimmed.toLowerCase();
      if (lower === 'exit') {
        console.log(pc.yellow('¡Hasta luego!'));
        break;
      }
      if (!trimmed) continue;

      process.stdout.write(pc.dim('Lexema está escribiendo... '));
      try {
        const reply = await callWorker(trimmed);
        console.log('\r' + pc.cyan('lexema > ') + reply + '\n');
      } catch (error) {
        console.log('\r' + pc.red('✖ ') + describeError(error) + '\n');
      }
    }
  });

const configCmd = program.command('config').description('Configura la CLI');

configCmd
  .command('set-url <url>')
  .description('Cambia la URL del Worker de Lexema')
  .action((url: string) => {
    const config = loadConfig();
    config.workerUrl = url;
    saveConfig(config);
    console.log(pc.green('✔ URL actualizada: ') + url);
  });

configCmd
  .command('set-token <token>')
  .description('Guarda el token de autenticación (Authorization: Bearer <token>)')
  .action((token: string) => {
    const config = loadConfig();
    config.token = token;
    saveConfig(config);
    console.log(pc.green('✔ Token guardado.'));
  });

configCmd
  .command('set-model <model>')
  .description('Fija el modelo por defecto')
  .action((model: string) => {
    const config = loadConfig();
    config.model = model;
    saveConfig(config);
    console.log(pc.green('✔ Modelo por defecto: ') + model);
  });

configCmd
  .command('show')
  .description('Muestra la configuración actual')
  .action(() => {
    const config = loadConfig();
    console.log(
      JSON.stringify(
        { ...config, token: config.token ? '••••••••' : undefined },
        null,
        2
      )
    );
  });

program.parse(process.argv);
