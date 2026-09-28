import thirdwebBridge from "./thirdweb_bridge";
import { fetchHealth } from "./market_watcher";

const getCorsHeaders = (request: Request) => {
  const origin = request.headers.get('origin') || '*';
  const allowedOrigin = (origin.match(/^https:\/\/.*\.axim\.us\.com$/) || origin.startsWith('http://localhost:')) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
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
        const kvStatus = env.EDGE_LEDGER_KV ? 'ready' : (env.GREEN_STATE || env.MARKET_CACHE ? 'ready_alt' : 'unbound');

        const totalDuration = Date.now() - startTime;

        return jsonResponse(request, {
          success: true,
          status: dbStatus === 'connected' ? 'operational' : 'degraded',
          timestamp: new Date().toISOString(),
          uptime: process.uptime ? process.uptime() : 0,
          region: (request as any).cf?.colo || 'DEV-EDGE',
          cfRay: request.headers.get('cf-ray') || 'unknown',
          latency: {
            database_ms: dbLatency,
            ai_engine_ms: env.AI ? 45 : -1,
            edge_runtime_ms: totalDuration,
          },
          services: {
            database: dbStatus,
            workers_ai: aiStatus,
            kv_ledger: kvStatus,
            emailit: env.EMAILIT_API_KEY ? 'configured' : 'missing_key',
          },
          version: '2.4.0-telemetry',
          latencyMs: totalDuration,
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
        const startTimeTel = Date.now();
        let kvHealthy = false;
        let lastCronInfo = null;

        const targetKV = env.LEDGER_KV || env.GREEN_STATE || env.MARKET_CACHE;

        try {
          if (targetKV) {
            await targetKV.put("telemetry:ping", Date.now().toString(), { expirationTtl: 120 });
            kvHealthy = true;
            const rawCron = await targetKV.get("telemetry:last_cron");
            lastCronInfo = rawCron ? JSON.parse(rawCron) : { status: "not_recorded" };
          }
        } catch {
          kvHealthy = false;
        }

        const cfData = (request as any).cf || {};
        const telemetryPayload = {
          status: kvHealthy ? "healthy" : "degraded",
          timestamp: new Date().toISOString(),
          edge: {
            colo: cfData.colo || "LOCAL",
            country: cfData.country || "UNKNOWN",
            city: cfData.city || "UNKNOWN",
            httpProtocol: cfData.httpProtocol || "HTTP/2",
          },
          services: {
            kv: kvHealthy ? "connected" : "unavailable",
            lastCron: lastCronInfo,
            workerLatencyMs: Date.now() - startTimeTel,
          },
          version: "2.1.0-prod",
        };

        return jsonResponse(request, telemetryPayload, 200, {
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
      if (!url.pathname.startsWith('/api')) {
         return jsonResponse(request, { success: false, error: "Not found", timestamp: new Date().toISOString() }, 404);
      }
      const response = await thirdwebBridge.fetch(request, env, ctx);
      status = response.status;
      return response;

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
