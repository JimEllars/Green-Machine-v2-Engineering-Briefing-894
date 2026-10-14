import { expect, test, describe } from 'vitest';
import worker from './index';

describe('Edge Ledger Worker Diagnostics', () => {
  const env = {
    GREEN_STATE: {
      get: async (key: string) => null,
      put: async () => {},
    },
    MARKET_CACHE: {
      get: async (key: string) => null,
      put: async () => {},
    },
    LEDGER_KV: {
      get: async (key: string) => {
        if (key === '__healthcheck__') return '1';
        if (key === '__health_probe__') return '1';
        return null;
      },
      put: async () => {},
    },
    SUPABASE_URL: 'https://mock.supabase.co',
    SUPABASE_ANON_KEY: 'mock-anon-key',
    EMAILIT_API_KEY: 'mock-emailit-key',
    THIRDWEB_SECRET_KEY: 'mock-thirdweb-key',
  };

  const ctx = {
    waitUntil: (promise: Promise<any>) => {},
  };

  test('OPTIONS /* returns correct CORS headers', async () => {
    const request = new Request('https://green-machine.axim.com/api/health', { method: 'OPTIONS' });
    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
  });

  test('GET /health returns HTTP 200 with { status: "operational" }', async () => {
    const request = new Request('https://green-machine.axim.com/api/health', { method: 'GET' });
    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const data: any = await response.json();
    expect(data.status).toBe('operational');
  });

  test('GET /api/telemetry returns HTTP 200 with new structured payload', async () => {
    const request = new Request('https://green-machine.axim.com/api/telemetry', {
      method: 'GET',
    });

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const data: any = await response.json();

    expect(data.status).toBe('healthy');
    expect(data.services.thirdweb_bridge.status).toBe('online');
  });

  test('Delegated routes do not return 404 from index (e.g. /api/admin/*)', async () => {
    // We mock thirdwebBridge to verify delegation?
    // Actually we just call a route that thirdwebBridge should handle.
    const request = new Request('https://green-machine.axim.com/api/admin/dept-summary', { method: 'GET' });
    const response = await worker.fetch(request, env, ctx);
    // Even if it fails (e.g., due to auth), it shouldn't be a 404 NOT_FOUND from index.ts catch-all
    expect(response.status).not.toBe(404);
  });

  test('Malformed routes return HTTP 404 with structured error JSON', async () => {
    const request = new Request('https://green-machine.axim.com/invalid-route', { method: 'GET' });
    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(404);
    const data: any = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('404 Not Found');
  });
});
