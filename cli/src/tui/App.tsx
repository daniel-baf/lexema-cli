import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdin } from 'ink';
import {
  callWorker,
  describeError,
  fetchModels,
  buildConversationPrompt,
  ChatTurn,
} from '../api';
import { loadConfig, saveConfig } from '../config';
import Header from './Header';
import { MessageRow, Entry } from './MessageList';
import InputBox from './InputBox';
import Spinner from './Spinner';

const HELP = 'Comandos: /model [nombre] · /clear · /help · /exit';
const HINT = 'Enter envía · ↑↓ historial · /help comandos · Esc sale';

// Limpia la pantalla real de la terminal (no solo el frame que Ink gestiona),
// para que "/clear" se sienta como un clear de verdad y no deje restos.
function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

export default function App() {
  const { exit } = useApp();
  const { internal_eventEmitter } = useStdin();
  const lastRawRef = useRef('');
  const configRef = useRef(loadConfig());
  const historyRef = useRef<ChatTurn[]>([]);
  const sentRef = useRef<string[]>([]);
  const histIdxRef = useRef(-1);
  const draftRef = useRef('');

  const [entries, setEntries] = useState<Entry[]>([]);
  const [clearGen, setClearGen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState(configRef.current.model || '(auto)');
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const pushEntry = useCallback((entry: Entry) => {
    setEntries((prev) => [...prev, entry]);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      setBusy(true);
      setNotice(null);
      pushEntry({ role: 'user', content: text });
      try {
        const prompt = buildConversationPrompt(historyRef.current, text);
        const reply = await callWorker(prompt);
        historyRef.current = [
          ...historyRef.current,
          { role: 'user', content: text },
          { role: 'assistant', content: reply },
        ];
        pushEntry({ role: 'assistant', content: reply });
      } catch (error) {
        pushEntry({ role: 'error', content: describeError(error) });
      } finally {
        setBusy(false);
      }
    },
    [pushEntry]
  );

  const runCommand = useCallback(
    async (raw: string) => {
      const spaceIdx = raw.search(/\s/);
      const cmd = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
      const arg = spaceIdx === -1 ? '' : raw.slice(spaceIdx).trim();

      if (cmd === '/exit' || cmd === '/quit') {
        exit();
        return;
      }
      if (cmd === '/clear') {
        clearScreen();
        historyRef.current = [];
        setEntries([]);
        setClearGen((g) => g + 1);
        setNotice('Conversación borrada.');
        return;
      }
      if (cmd === '/help') {
        setNotice(HELP);
        return;
      }
      if (cmd === '/model') {
        if (!arg) {
          setBusy(true);
          try {
            const info = await fetchModels();
            setNotice(
              `Proveedor: ${info.provider} · por defecto: ${info.defaultModel}` +
                (info.models && info.models.length
                  ? ` · permitidos: ${info.models.join(', ')}`
                  : ' · (sin restricción de modelos)')
            );
          } catch (error) {
            setNotice(describeError(error));
          } finally {
            setBusy(false);
          }
          return;
        }
        const config = loadConfig();
        config.model = arg;
        saveConfig(config);
        configRef.current = config;
        setModel(arg);
        setNotice(`Modelo fijado: ${arg}`);
        return;
      }
      setNotice(`Comando desconocido: ${cmd}. ${HELP}`);
    },
    [exit]
  );

  // Ink clasifica el DEL crudo (\x7f, lo que manda la tecla física Backspace
  // en la mayoría de terminales) como key.delete por compatibilidad histórica,
  // igual que la secuencia de escape de la tecla Delete real (\x1b[3~) — y no
  // expone la secuencia cruda en su API pública de useInput. Para no confundir
  // "borrar hacia atrás" con "borrar hacia adelante" nos suscribimos al emisor
  // interno de ink (antes de llamar a useInput, así corre primero) para ver el
  // byte real y decidir la dirección nosotros mismos.
  useEffect(() => {
    const onRaw = (raw: string) => {
      lastRawRef.current = raw;
    };
    internal_eventEmitter?.on('input', onRaw);
    return () => {
      internal_eventEmitter?.removeListener('input', onRaw);
    };
  }, [internal_eventEmitter]);

  useInput((data, key) => {
    if (key.return || data === '\n') {
      const text = input.trim();
      if (!text || busy) return;
      sentRef.current.push(input);
      histIdxRef.current = -1;
      draftRef.current = '';
      setInput('');
      setCursor(0);
      if (text.startsWith('/')) void runCommand(text);
      else void sendMessage(text);
      return;
    }

    if (key.escape) {
      exit();
      return;
    }

    if (key.upArrow) {
      const hist = sentRef.current;
      if (hist.length === 0) return;
      if (histIdxRef.current === -1) {
        draftRef.current = input;
        histIdxRef.current = hist.length;
      }
      const idx = Math.max(0, histIdxRef.current - 1);
      histIdxRef.current = idx;
      setInput(hist[idx]);
      setCursor(hist[idx].length);
      return;
    }

    if (key.downArrow) {
      const hist = sentRef.current;
      if (histIdxRef.current === -1) return;
      const idx = histIdxRef.current + 1;
      if (idx >= hist.length) {
        histIdxRef.current = -1;
        setInput(draftRef.current);
        setCursor(draftRef.current.length);
        return;
      }
      histIdxRef.current = idx;
      setInput(hist[idx]);
      setCursor(hist[idx].length);
      return;
    }

    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(input.length, c + 1));
      return;
    }

    // key.backspace/key.delete de ink no distinguen la tecla física Backspace
    // (que suele mandar el byte crudo \x7f o \x08) de la tecla Delete real
    // (secuencia de escape \x1b[3~): ambas llegan como key.delete. Usamos el
    // byte crudo capturado arriba para decidir la dirección real del borrado.
    const raw = lastRawRef.current;
    const isRawEraseByte = raw === '\x7f' || raw === '\b' || raw === '\x1b\x7f' || raw === '\x1b\b';
    const isBackspace = key.backspace || (key.delete && isRawEraseByte);
    const isForwardDelete = key.delete && !isRawEraseByte;

    if (isBackspace || isForwardDelete) {
      if (cursor === 0 && isBackspace) return;
      const from = isBackspace ? cursor - 1 : cursor;
      const to = isBackspace ? cursor : cursor + 1;
      if (from < 0 || from >= input.length) return;
      const next = input.slice(0, from) + input.slice(to);
      setInput(next);
      setCursor(Math.max(0, from));
      return;
    }

    if (data && !key.ctrl && !key.meta) {
      const next = input.slice(0, cursor) + data + input.slice(cursor);
      setInput(next);
      setCursor(cursor + data.length);
    }
  });

  let host = configRef.current.workerUrl;
  try {
    host = new URL(configRef.current.workerUrl).host;
  } catch {
    host = configRef.current.workerUrl;
  }

  return (
    <React.Fragment>
      <Static key={clearGen} items={entries}>
        {(entry, i) => <MessageRow key={i} entry={entry} />}
      </Static>
      <Box flexDirection="column" width="100%">
        <Header model={model} host={host} />
        {notice && <Text color="yellow">{notice}</Text>}
        {busy && <Spinner label="Lexema está pensando..." />}
        <InputBox value={input} cursor={cursor} busy={busy} placeholder="escribe tu mensaje..." />
        <Text dimColor>{HINT}</Text>
      </Box>
    </React.Fragment>
  );
}
