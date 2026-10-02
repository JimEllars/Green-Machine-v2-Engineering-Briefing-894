import thirdwebBridge from "./thirdweb_bridge";
import { fetchHealth } from "./market_watcher";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, apikey, X-Axim-Signature",
};

export function handleCors(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }
  return null;
}

export function jsonError(message: string, status: number = 400, code: string = 'BAD_REQUEST', extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify({
    success: false,
    error: { message, code, timestamp: new Date().toISOString() }
  }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders }
  });
}

export function jsonResponse(request: Request, data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startTime = performance.now();
    let status = 200;
    const rayId = request.headers.get("cf-ray") || "unknown";

    const corsRes = handleCors(request);
    if (corsRes) return corsRes;

    let response: Response;

    try {
      if (!env.SUPABASE_URL || !env.EMAILIT_API_KEY || !env.THIRDWEB_SECRET_KEY) {
        console.warn(JSON.stringify({
           level: "warn",
           requestId,
           message: "Missing critical environment variables."
        }));
      }

      const url = new URL(request.url);

      if (url.pathname === "/api/health" || url.pathname === "/status" || url.pathname === "/api/telemetry") {
        let kvStatus = "connected";
        let kvLatency = 0;

        try {
          const probeStart = performance.now();
          if (env.LEDGER_KV) {
             await env.LEDGER_KV.get("__health_probe__");
          } else if (env.GREEN_STATE) {
             await env.GREEN_STATE.get("__health_probe__");
          } else if (env.MARKET_CACHE) {
             await env.MARKET_CACHE.get("__health_probe__");
          }
          kvLatency = Math.round(performance.now() - probeStart);
        } catch (err) {
          kvStatus = "degraded";
        }

        const edgeLatencyMs = Math.round(performance.now() - startTime);

        const payload = {
          status: kvStatus === "connected" ? "healthy" : "degraded",
          timestamp: new Date().toISOString(),
          region: (request as any).cf?.colo || 'unknown',
          services: {
            supabase: env.SUPABASE_URL ? "operational" : "unconfigured",
            marketWatcher: "operational",
            thirdweb: env.THIRDWEB_SECRET_KEY ? "operational" : "unconfigured",
            emailit: env.EMAILIT_API_KEY ? "operational" : "unconfigured",
            kv: { status: kvStatus, latency_ms: kvLatency },
            thirdweb_bridge: { status: env.THIRDWEB_SECRET_KEY ? "online" : "unconfigured" },
            ai_engine: { status: "active" },
          },
          telemetry: {
            edgeLatencyMs,
            rayId
          },
          success: true
        };

        response = new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      }

      else if (url.pathname.startsWith("/api/bridge/")) {
        response = await thirdwebBridge.fetch(request, env, ctx);
      }

      else if (url.pathname.startsWith("/api/market/")) {
        response = await fetchHealth(env, request, ctx);
      }

      else if (url.pathname.startsWith("/api/briefing/")) {
        const { dispatchExecutiveBriefing } = await import("./briefing_generator");
        const html = await dispatchExecutiveBriefing(env, ctx);
        response = jsonResponse(request, { status: "briefing_dispatched", html }, 200);
      } else {
        response = jsonError("Not found", 404, 'NOT_FOUND');
      }

    } catch (error: any) {
      status = 500;
      response = jsonError(error.message, 500, 'INTERNAL_SERVER_ERROR');
    }

    status = response.status;
    const duration = Math.round(performance.now() - startTime);

    const newHeaders = new Headers(response.headers);
    newHeaders.set("Server-Timing", `edge;dur=${duration}`);
    newHeaders.set("X-Edge-Origin", "cloudflare-worker");
    newHeaders.set("X-Ray-Trace", rayId);

    // Copy headers from response and overwrite with new telemetry headers
    const finalResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
    });

    const logPayload = {
        requestId,
        rayId,
        method: request.method,
        url: request.url,
        status,
        latencyMs: duration,
        timestamp: new Date().toISOString()
    };
    if (ctx) {
      ctx.waitUntil(Promise.resolve().then(() => {
           console.log(JSON.stringify(logPayload));
      }));
    }

    return finalResponse;
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
