import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  outfile: 'dist/index.mjs',
  alias: { 'react-devtools-core': './stubs/react-devtools-core.js' },
  banner: {
    js: "import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);",
  },
});
console.log('dist/index.mjs');
