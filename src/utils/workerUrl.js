export function getWorkerUrl() {
  if (import.meta.env && import.meta.env.VITE_WORKER_URL) {
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
      // Offline mock response check
      if (!navigator.onLine) {
         throw new Error("Navigator is offline, forcing fallback.");
      }

      const response = await fetch(url, options);
      if (!response.ok && response.status >= 500) {
        throw new Error(`Server Error ${response.status}`);
      }
      return response;
    } catch (error) {
      attempt++;
      if (attempt > retries) {
        console.warn(`[fetchWithWorkerFallback] Worker unreachable after ${retries} retries, using cached state fallback for ${endpoint}`);

        // Attempt to retrieve a local cached response if available
        let cachedData = [];
        try {
           const cacheKey = `fallback_cache_${endpoint}`;
           const stored = localStorage.getItem(cacheKey);
           if (stored) cachedData = JSON.parse(stored);
        } catch(e) { /* ignore */ }

        // Return a mock response indicating degraded state
        return new Response(JSON.stringify({
           status: 'degraded',
           data: cachedData,
           latencyMs: 0,
           timestamp: new Date().toISOString(),
           _fallback: true
        }), {
           status: 200,
           headers: { 'Content-Type': 'application/json', 'X-Cache-Status': 'STALE-FALLBACK' }
        });
      }
      // Exponential backoff: 500ms, 1000ms
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
}

// Intercept normal fetch to save to cache for fallback
export async function fetchAndCache(endpoint, options = {}) {
    const response = await fetchWithWorkerFallback(endpoint, options);

    // Only cache successful requests that are NOT already fallbacks
    if (response.ok && response.headers.get('X-Cache-Status') !== 'STALE-FALLBACK' && (!options.method || options.method === 'GET')) {
       try {
           const cloned = response.clone();
           const data = await cloned.json();
           if (data.data) {
               localStorage.setItem(`fallback_cache_${endpoint}`, JSON.stringify(data.data));
           }
       } catch(e) { /* ignore */ }
    }

    return response;
}
