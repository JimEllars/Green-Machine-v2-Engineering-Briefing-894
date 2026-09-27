import thirdwebBridge from "./thirdweb_bridge";
import { fetchHealth } from "./market_watcher";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Axim-Signature",
};

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let status = 200;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
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

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        return new Response(
          JSON.stringify({
            status: "operational",
            version: "v2.4.0-edge",
            timestamp: Date.now(),
            region: (request as any).cf?.colo || "local",
          }),
          {
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
      }

      if (url.pathname === "/telemetry" || url.pathname === "/api/telemetry") {
        // Mock KV read for latency
        const startKv = performance.now();
        let kvStatus = "unreachable";
        try {
            if (env.GREEN_STATE) {
                await env.GREEN_STATE.get("telemetry_test_key");
                kvStatus = "operational";
            } else if (env.MARKET_CACHE) {
                await env.MARKET_CACHE.get("telemetry_test_key");
                kvStatus = "operational";
            }
        } catch (e) {
            kvStatus = "error";
        }
        const latency = performance.now() - startKv;

        const memoryInfo = (process as any).memoryUsage ? (process as any).memoryUsage() : { heapUsed: 0 };

        return new Response(
          JSON.stringify({
            status: "operational",
            version: "v2.4.0-edge",
            kv_status: kvStatus,
            kv_read_latency_ms: Math.round(latency),
            memory_usage: memoryInfo,
            system_uptime: (process as any).uptime ? (process as any).uptime() : 0,
            timestamp: Date.now(),
          }),
          {
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
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
        await dispatchExecutiveBriefing(env, ctx);
        status = 200;
        return new Response(JSON.stringify({ status: "briefing_dispatched" }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      // Default route
      const response = await thirdwebBridge.fetch(request, env, ctx);
      status = response.status;
      return response;

    } catch (error: any) {
      status = 500;
      return new Response(
        JSON.stringify({ status: "error", message: error.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
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
    if (thirdwebBridge.scheduled) {
      await thirdwebBridge.scheduled(event, env, ctx);
    }
  }
};
