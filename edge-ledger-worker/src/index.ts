import thirdwebBridge from "./thirdweb_bridge";
import { fetchHealth } from "./market_watcher";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Axim-Signature",
};

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Validate environment variables gracefully
      if (!env.SUPABASE_URL || !env.EMAILIT_API_KEY || !env.THIRDWEB_SECRET_KEY) {
        console.warn("Missing critical environment variables.");
      }

      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return new Response(
          JSON.stringify({
            status: "ok",
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

      if (url.pathname === "/api/telemetry") {
        // Mock KV read for latency
        const start = performance.now();
        if (env.GREEN_STATE) {
            await env.GREEN_STATE.get("telemetry_test_key");
        }
        const latency = performance.now() - start;

        return new Response(
          JSON.stringify({
            status: "ok",
            kv_read_latency_ms: Math.round(latency),
            memory_state: "healthy",
            system_uptime: process.uptime ? process.uptime() : 0,
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
        return await thirdwebBridge.fetch(request, env, ctx);
      }

      if (url.pathname.startsWith("/api/market/")) {
        return await fetchHealth(env, request, ctx);
      }

      if (url.pathname.startsWith("/api/briefing/")) {
        // Route to briefing_generator.ts logic?
        // We need to implement this or just return a placeholder for now
        // Let's import dispatchExecutiveBriefing
        const { dispatchExecutiveBriefing } = await import("./briefing_generator");
        await dispatchExecutiveBriefing(env, ctx);
        return new Response(JSON.stringify({ status: "briefing_dispatched" }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      // Default route
      return await thirdwebBridge.fetch(request, env, ctx);

    } catch (error: any) {
      return new Response(
        JSON.stringify({ status: "error", message: error.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }
  },

  async scheduled(event: any, env: any, ctx: any) {
    if (thirdwebBridge.scheduled) {
      await thirdwebBridge.scheduled(event, env, ctx);
    }
  }
};
