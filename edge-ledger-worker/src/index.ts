import thirdwebBridge from "./thirdweb_bridge";
import { fetchHealth } from "./market_watcher";

const getCorsHeaders = (request: Request) => {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Client-Version, X-Axim-Signature, x-client-info, apikey',
    'Access-Control-Max-Age': '86400',
  };
};

export function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

export function jsonResponse(request: Request, data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(request),
      ...extraHeaders,
    },
  });
}

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let status = 200;

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    try {
      // Validate environment variables gracefully
      if (!env.SUPABASE_URL || !env.EMAILIT_API_KEY || !env.THIRDWEB_SECRET_KEY) {
        console.warn(JSON.stringify({
           level: "warn",
           requestId,
           message: "Missing critical environment variables."
        }));
      }

      const url = new URL(request.url);

      if (url.pathname === "/diagnostics" || url.pathname === "/api/diagnostics") {
        const startTime = Date.now();

        // 1. Database Ping Check
        let dbStatus = 'disconnected';
        let dbLatency = -1;
        try {
          const dbStart = Date.now();
          const res = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
            method: 'GET',
            headers: {
              'apikey': env.SUPABASE_ANON_KEY || '',
              'Authorization': `Bearer ${env.SUPABASE_ANON_KEY || ''}`,
            },
          });
          if (res.ok) {
            dbStatus = 'connected';
            dbLatency = Date.now() - dbStart;
          } else {
            dbStatus = 'degraded';
          }
        } catch {
          dbStatus = 'unreachable';
        }

        // 2. AI Engine Status
        const aiStatus = env.AI ? 'available' : 'not_bound';

        // 3. KV Namespace Status
        let kvStatus = env.LEDGER_KV ? 'READY' : 'UNBOUND';
        let kvLatency = -1;
        const targetKV = env.LEDGER_KV || env.GREEN_STATE || env.MARKET_CACHE;
        if (targetKV) {
           const pingStart = Date.now();
           try {
             await targetKV.put("__healthcheck__", "1", { expirationTtl: 60 });
             await targetKV.get("__healthcheck__");
             kvLatency = Date.now() - pingStart;
             kvStatus = 'READY';
           } catch (e) {
             kvStatus = 'degraded';
           }
        }

        const totalDuration = Date.now() - startTime;

        return jsonResponse(request, {
          status: dbStatus === 'connected' && kvStatus !== 'degraded' ? 'operational' : 'degraded',
          timestamp: new Date().toISOString(),
          workerRegion: (request as any).cf?.colo || 'local-dev',
          bindings: {
            database: dbStatus === 'connected',
            thirdweb: !!env.THIRDWEB_SECRET_KEY,
            emailit: !!env.EMAILIT_API_KEY,
            kv: kvStatus === 'READY'
          },
          telemetry: {
            requestCount: 1,
            latencyMs: kvLatency,
            memory: 'stable'
          }
        }, 200, {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
      }

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        return jsonResponse(request, {
            status: "healthy",
            version: "v2.1.0-telemetry",
            timestamp: new Date().toISOString(),
            region: (request as any).cf?.colo || "local",
        }, 200, {
            "Cache-Control": "no-cache, no-store, must-revalidate",
        });
      }

      if (url.pathname === "/telemetry" || url.pathname === "/api/telemetry") {
        const startTimeTel = performance.now();
        let kvHealthy = false;
        let kvLatencyMs = 0;
        let lastCronInfo = null;

        const targetKV = env.LEDGER_KV || env.GREEN_STATE || env.MARKET_CACHE;
        let kvStatus = 'unreachable';

        try {
          if (targetKV) {
            const pingStart = performance.now();
            await targetKV.put("__healthcheck__", "1", { expirationTtl: 60 });
            const pingRead = await targetKV.get("__healthcheck__");
            kvLatencyMs = Math.round(performance.now() - pingStart);
            kvStatus = pingRead === '1' ? 'healthy' : 'degraded';
            kvHealthy = pingRead === '1';

            const rawCron = await targetKV.get("telemetry:last_cron");
            lastCronInfo = rawCron ? JSON.parse(rawCron) : { status: "not_recorded" };
          }
        } catch {
          kvStatus = 'unreachable';
          kvHealthy = false;
        }

        let cbStatus = 'operational';
        try {
          if (targetKV) {
             const emailitCb = await targetKV.get("emailit_circuit_breaker");
             if (emailitCb === "open") {
                 cbStatus = 'degraded';
             }
          }
        } catch {
        }

        const cfData = (request as any).cf || {};
        const telemetryPayload = {
          status: 'ok',
          timestamp: new Date().toISOString(),
          workerRegion: cfData.colo || "UNKNOWN",
          executionTimeMs: Math.round(performance.now() - startTimeTel),
          subsystems: {
            kv: { status: kvStatus, latencyMs: kvLatencyMs },
            thirdwebBridge: { configured: !!env.THIRDWEB_SECRET_KEY },
            emailit: { configured: !!env.EMAILIT_API_KEY, circuitBreaker: cbStatus },
            database: { configured: !!env.SUPABASE_URL }
          },
          edge: {
            colo: cfData.colo || "LOCAL",
            country: cfData.country || "UNKNOWN",
            city: cfData.city || "UNKNOWN",
            httpProtocol: cfData.httpProtocol || "HTTP/2",
          },
          services: {
            kv: kvHealthy ? "connected" : "unavailable",
            lastCron: lastCronInfo,
            workerLatencyMs: Math.round(performance.now() - startTimeTel),
          },
          version: "2.1.0-prod",
        };

        return jsonResponse(request, telemetryPayload, 200, {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
      }

      if (url.pathname.startsWith("/api/bridge/")) {
        const response = await thirdwebBridge.fetch(request, env, ctx);
        status = response.status;
        return response;
      }

      if (url.pathname.startsWith("/api/market/")) {
        const response = await fetchHealth(env, request, ctx);
        status = response.status;
        return response;
      }

      if (url.pathname.startsWith("/api/briefing/")) {
        // Route to briefing_generator.ts logic
        const { dispatchExecutiveBriefing } = await import("./briefing_generator");
        const html = await dispatchExecutiveBriefing(env, ctx);
        status = 200;
        return jsonResponse(request, { status: "briefing_dispatched", html }, 200);
      }

      // Default route
      // Memory hint: Edge worker routing must implement strict catch-all termination layers to prevent unmapped API endpoint requests from falling through to base tracking payload loops.
      return jsonResponse(request, { success: false, error: "Not found", timestamp: new Date().toISOString() }, 404);

    } catch (error: any) {
      status = 500;
      return jsonResponse(request, { success: false, error: error.message, timestamp: new Date().toISOString() }, 500);
    } finally {
        const latencyMs = Date.now() - startTime;
        const logPayload = {
            requestId,
            method: request.method,
            url: request.url,
            status,
            latencyMs,
            timestamp: new Date().toISOString()
        };
        ctx.waitUntil(Promise.resolve().then(() => {
             console.log(JSON.stringify(logPayload));
        }));
    }
  },

  async scheduled(event: any, env: any, ctx: any) {
    const runStart = Date.now();
    let outcome = "success";
    let errorMsg = null;

    try {
      if (thirdwebBridge.scheduled) {
        await thirdwebBridge.scheduled(event, env, ctx);
      }
    } catch (err: any) {
      outcome = "failed";
      errorMsg = err?.message || String(err);
    } finally {
      const targetKV = env.LEDGER_KV || env.GREEN_STATE || env.MARKET_CACHE;
      if (targetKV) {
        const cronLog = {
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - runStart,
          status: outcome,
          error: errorMsg,
          cronSchedule: event.cron,
        };
        ctx.waitUntil(
          targetKV.put("telemetry:last_cron", JSON.stringify(cronLog), { expirationTtl: 86400 * 7 })
        );
      }
    }
  }
};
