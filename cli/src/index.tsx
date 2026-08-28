#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import * as readline from 'node:readline';
import { render } from 'ink';
import App from './tui/App';
import {
  callWorker,
  describeError,
  fetchModels,
  buildConversationPrompt,
  ChatTurn,
} from './api';
import { loadConfig, saveConfig } from './config';

const VERSION = '1.0.2'; // mantenla en sincronía con package.json

const program = new Command();

program
  .name('lexema')
  .description('CLI oficial de Lexema Labs para IA en la terminal')
  .version(VERSION);

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

const BANNER = '─── Lexema chat simple (escribe "exit" para salir) ───';

async function runSimpleChat() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(pc.bold(pc.cyan('\n' + BANNER + '\n')));
  const history: ChatTurn[] = [];

  // Usamos el iterador async de readline (`for await...of rl`) en vez de
  // encadenar rl.question() manualmente: question() solo escucha una línea
  // a la vez, así que si stdin llega más rápido de lo que procesamos
  // (piped input, scripts) se pierden líneas o se lanza
  // ERR_USE_AFTER_CLOSE al preguntar de nuevo tras el EOF. El iterador no
  // pierde líneas y termina limpio al llegar el EOF real.
  // stdin puede cerrarse (EOF) entre el fin de una operación async (p.ej.
  // callWorker) y la siguiente llamada a rl.prompt(); en ese caso Node
  // lanza ERR_USE_AFTER_CLOSE. Lo ignoramos: el for-await de abajo termina
  // solo en cuanto rl emite 'close'.
  const safePrompt = () => {
    try {
      rl.prompt();
    } catch {
      /* rl ya cerrado, el for-await terminará en la próxima vuelta */
    }
  };

  rl.setPrompt(pc.green('you > '));
  safePrompt();

  for await (const raw of rl) {
    const text = raw.trim();
    const lower = text.toLowerCase();
    if (lower === 'exit' || text === '/exit') break;
    if (!text) {
      safePrompt();
      continue;
    }
    if (text === '/clear') {
      // Limpia la pantalla real, no solo el historial en memoria, para que
      // "/clear" se sienta como un clear de verdad.
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      history.length = 0;
      console.log(pc.bold(pc.cyan(BANNER + '\n')));
      console.log(pc.dim('Conversación borrada.\n'));
      safePrompt();
      continue;
    }
    if (text === '/help') {
      console.log(pc.dim('Comandos: /clear · /help · /exit'));
      safePrompt();
      continue;
    }

    process.stdout.write(pc.dim('Lexema está escribiendo...\n'));
    try {
      const reply = await callWorker(buildConversationPrompt(history, text));
      history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      console.log(pc.cyan('lexema > ') + reply + '\n');
    } catch (error) {
      console.log(pc.red('✖ ') + describeError(error) + '\n');
    }
    safePrompt();
  }
  rl.close();
  console.log(pc.yellow('¡Hasta luego!'));
}

program
  .command('chat')
  .description('Sesión interactiva de conversación')
  .option('--no-tui', 'Usa el modo simple sin interfaz interactiva')
  .action(async (opts: { tui: boolean }) => {
    if (opts.tui && process.stdout.isTTY) {
      const instance = render(<App />);
      await instance.waitUntilExit();
      console.log(pc.yellow('\n¡Hasta luego!'));
      return;
    }
    if (opts.tui) console.log(pc.dim('Terminal sin TTY: usando modo simple.'));
    await runSimpleChat();
  });

program
  .command('models')
  .description('Lista los modelos disponibles en el servidor')
  .action(async () => {
    try {
      const info = await fetchModels();
      console.log(pc.bold(pc.cyan('Proveedor:')) + ' ' + info.provider);
      console.log(pc.bold(pc.cyan('Modelo por defecto:')) + ' ' + info.defaultModel);
      console.log(
        pc.bold(pc.cyan('Modelos:')) +
          ' ' +
          (info.models && info.models.length
            ? info.models.join(', ')
            : '(sin restricción, usa -m <modelo>)')
      );
    } catch (error) {
      console.log(pc.red('✖ ') + describeError(error));
      process.exitCode = 1;
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
