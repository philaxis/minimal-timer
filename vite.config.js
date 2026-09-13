import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [{
    name: 'cache-app-shell',
    generateBundle(_options, bundle) {
      const base = process.env.VITE_BASE_PATH || '/';
      const assets = Object.keys(bundle).filter(name => /\.(js|css)$/.test(name)).map(name => `${base}${name}`);
      let source = readFileSync('public/sw.js', 'utf8').replace('const BUILD_ASSETS = [];', `const BUILD_ASSETS = ${JSON.stringify(assets)};`);
      const version = createHash('sha256').update(source).digest('hex').slice(0, 12);
      source = source.replace('tempo-shell-v1', `tempo-shell-${version}`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  }],
});
