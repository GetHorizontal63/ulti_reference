// Single place that decides where /api/ requests go, so the same build works
// on every host:
//   TrueNAS (Nginx proxies /api/)       VITE_API_BASE unset  → /api/...
//   GitHub Pages (static, no backend)   VITE_API_BASE=https://yourdomain.com
//   Vite dev server (proxy to :8000)    VITE_API_BASE unset  → /api/...
//
// Pages call fetch('/api/...') directly (and some prefix the app base path,
// e.g. `${BASE}/api/...`); installApiFetch() rewrites those at runtime so the
// call sites don't each need to know about deployment.

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const APP_BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

export function apiUrl(path) {
  if (APP_BASE && path.startsWith(`${APP_BASE}/api/`)) {
    path = path.slice(APP_BASE.length);
  }
  return path.startsWith('/api/') ? `${API_BASE}${path}` : path;
}

export function installApiFetch() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) =>
    nativeFetch(typeof input === 'string' ? apiUrl(input) : input, init);
}
