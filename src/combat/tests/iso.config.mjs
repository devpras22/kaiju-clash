// Isolated build: swaps MonsterModel for the stub. npx vite build -c src/combat/tests/iso.config.mjs --outDir /tmp/kb-iso
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
export default {
  root,
  plugins: [{ name: 'stub-model', enforce: 'pre', resolveId(id) { if (id.endsWith('models/MonsterModel.js')) return path.join(root, 'src/combat/tests/StubModel.js'); } }],
};
