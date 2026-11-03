import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// '/' for TrueNAS; the Pages workflow passes /<repo>/
const base = process.env.VITE_BASE ?? '/';

// Static JSON bundles live in ../data/exports (gitignored, same layout as the
// TrueNAS dataset). In production Nginx serves them at /data/; this does the
// same for `npm run dev`.
const EXPORTS_DIR = path.resolve(__dirname, '..', 'data', 'exports');

function serveExports() {
  return {
    name: 'serve-data-exports',
    configureServer(server) {
      server.middlewares.use(`${base}data`, (req, res, next) => {
        const file = path.join(EXPORTS_DIR, decodeURIComponent(req.url.split('?')[0]));
        if (!file.startsWith(EXPORTS_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveExports()],
  base,
  cacheDir: path.join(__dirname, 'node_modules', '.vite'),
  server: {
    watch: {
      ignored: ['**/node_modules/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,  // don't publish 7 MB of source to every visitor
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime'],
  },
});
