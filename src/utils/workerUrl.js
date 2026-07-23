export function getWorkerUrl() {
  if (import.meta.env.VITE_WORKER_URL) {
    return import.meta.env.VITE_WORKER_URL;
  }
  if (window.location.hostname.endsWith('.pages.dev')) {
    return window.location.origin;
  }
  const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  return IS_LOCAL ? 'http://localhost:8787' : window.location.origin;
}
