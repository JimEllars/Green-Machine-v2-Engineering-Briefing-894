import re

with open("edge-ledger-worker/src/market_watcher.ts", "r") as f:
    content = f.read()

replacement = """
    const multiSourceData = {
      crypto: results,
      _telemetry_timestamp: Date.now(),
      provider: "anny_trade_rest"
    };

    // 2. Dynamic Volatility Circuit Breaker
    // Check if any asset dropped > 8% over a 15 min window.
    // In our simplified simulation, we will trigger it if change_24h < -8.0
    // or simulate a drop based on recent telemetry.
    let circuitBreakerTriggered = false;
    let worstAsset = "";
    let worstDrop = 0;

    for (const [asset, data] of Object.entries(results)) {
       const change = (data as any).change_24h;
       // Simulating a 15m flash drop using 24h change for the POC context,
       // but typically would calculate against the latest 15m delta.
       if (change < -8.0) {
          circuitBreakerTriggered = true;
          worstAsset = asset;
          worstDrop = change;
          break;
       }
    }

    if (circuitBreakerTriggered) {
       console.log(`[CIRCUIT_BREAKER] Flash drop detected on ${worstAsset} (${worstDrop.toFixed(2)}%). Activating safety protocol.`);
       await env.GREEN_STATE.put("CIRCUIT_BREAKER_ACTIVE", "true", { metadata: { asset: worstAsset, drop: worstDrop, timestamp: Date.now() } });

       // Dispatch alert to AXiM Core
       if ((env as any).SUPABASE_URL && (env as any).SUPABASE_SERVICE_KEY) {
          if (ctx) ctx.waitUntil((async () => {
             try {
                await fetch(`${(env as any).SUPABASE_URL}/rest/v1/api_usage_logs`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${(env as any).SUPABASE_SERVICE_KEY}`,
                    apikey: (env as any).SUPABASE_SERVICE_KEY,
                  },
                  body: JSON.stringify({
                    endpoint: "/api/v1/telemetry/micro-app",
                    status_code: 200,
                    error_message: `treasury.circuit_breaker_triggered: ${worstAsset} flash crash`,
                    count: 1,
                  }),
                });
             } catch (err) {}
          })());
       }
    }

    // Cache in KV with strict 30-second TTL
"""

content = content.replace("""
    const multiSourceData = {
      crypto: results,
      _telemetry_timestamp: Date.now(),
      provider: "anny_trade_rest"
    };

    // Cache in KV with strict 30-second TTL
""", replacement)


content = content.replace(
    "export async function syncMarketCache(env: Env): Promise<void> {",
    "export async function syncMarketCache(env: Env, ctx?: ExecutionContext): Promise<void> {"
)

content = content.replace(
    "ctx.waitUntil((async () => {",
    "if (ctx) ctx.waitUntil((async () => {"
)


with open("edge-ledger-worker/src/market_watcher.ts", "w") as f:
    f.write(content)
