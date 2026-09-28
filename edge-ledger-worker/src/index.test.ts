import { expect, test, describe, vi } from 'vitest';
import worker from './index';

describe('Edge Ledger Worker Diagnostics', () => {
  const env = {
    SUPABASE_URL: 'https://mock.supabase.co',
    EMAILIT_API_KEY: 'mock_emailit',
    THIRDWEB_SECRET_KEY: 'mock_thirdweb',
    LEDGER_KV: {
      get: vi.fn(),
      put: vi.fn()
    },
    AI: {}
  };
  const ctx = {
    waitUntil: vi.fn()
  };

  test('GET /health returns HTTP 200 with { status: "healthy" }', async () => {
    const request = new Request('https://green-machine.axim.com/api/health', { method: 'GET' });
    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('healthy');
  });

  test('OPTIONS /* returns correct CORS headers', async () => {
    const request = new Request('https://green-machine.axim.com/api/some-endpoint', { method: 'OPTIONS' });
    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  test('GET /api/diagnostics handles missing KV/thirdweb secrets gracefully', async () => {
    // Override fetch for Supabase Ping Check
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as any);

    const partialEnv = {}; // Missing secrets
    const request = new Request('https://green-machine.axim.com/api/diagnostics', { method: 'GET' });
    const response = await worker.fetch(request, partialEnv, ctx);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.services.kv_ledger).toBe('unbound');
    expect(data.services.emailit).toBe('missing_key');
  });

  test('Malformed routes return HTTP 404 with structured error JSON', async () => {
    const request = new Request('https://green-machine.axim.com/invalid-route', { method: 'GET' });
    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Not found');
    expect(data.timestamp).toBeDefined();
  });
});
