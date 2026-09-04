export interface SlashCommand {
  cmd: string;
  arg: string;
}

// Replica el split usado hoy en App.tsx (y equivalente en el chat simple):
// separa en el primer espacio, sin lowercase (los comandos se comparan tal
// cual el usuario los escribe, ej. "/model").
export function parseSlashCommand(raw: string): SlashCommand {
  const spaceIdx = raw.search(/\s/);
  const cmd = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
  const arg = spaceIdx === -1 ? '' : raw.slice(spaceIdx).trim();
  return { cmd, arg };
}

// `allowed === null` significa "sin restricción de modelos" (el server no
// la impone o no se pudo consultar).
export function validateModel(arg: string, allowed: string[] | null): boolean {
  if (!allowed) return true;
  return allowed.includes(arg);
}
