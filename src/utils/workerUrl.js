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

export async function fetchWithWorkerFallback(endpoint, options = {}, retries = 2) {
  const url = `${getWorkerUrl()}${endpoint}`;
  let attempt = 0;

  while (attempt <= retries) {
    try {
      const response = await fetch(url, options);
      if (!response.ok && response.status >= 500) {
        throw new Error(`Server Error ${response.status}`);
      }
      return response;
    } catch (error) {
      attempt++;
      if (attempt > retries) {
        console.warn(`[fetchWithWorkerFallback] Worker unreachable after ${retries} retries, using cached state fallback for ${endpoint}`);

        // Return a mock response indicating degraded state
        return new Response(JSON.stringify({
           status: 'degraded',
           data: [],
           latencyMs: 0,
           timestamp: new Date().toISOString(),
           _fallback: true
        }), {
           status: 200,
           headers: { 'Content-Type': 'application/json' }
        });
      }
      // Exponential backoff: 500ms, 1000ms
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
}
