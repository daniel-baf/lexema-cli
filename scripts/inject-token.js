// Inyecta el token compartido por defecto en el bundle ya compilado.
// Se corre en CI (después de `npm run build`, antes de `bun build --compile`)
// leyendo el valor real desde la variable de entorno LEXEMA_CLIENT_TOKEN
// (poblada desde un secreto de GitHub Actions). El código fuente commiteado
// nunca contiene el token.
const fs = require('fs');
const path = require('path');

const token = process.env.LEXEMA_CLIENT_TOKEN;
if (!token) {
  console.log('LEXEMA_CLIENT_TOKEN no está definido; el binario quedará sin token por defecto.');
  process.exit(0);
}

const bundlePath = path.join(__dirname, '..', 'cli', 'dist', 'index.mjs');
const marker = 'DEFAULT_CLIENT_TOKEN = ""';

let content = fs.readFileSync(bundlePath, 'utf8');
if (!content.includes(marker)) {
  throw new Error(
    `No se encontró el marcador "${marker}" en ${bundlePath}. ¿Cambió cli/src/config.ts?`
  );
}

content = content.replace(marker, `DEFAULT_CLIENT_TOKEN = ${JSON.stringify(token)}`);
fs.writeFileSync(bundlePath, content);
console.log('Token por defecto inyectado en dist/index.mjs');
