import type { KVNamespace, ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';

export interface Env {
  MARKET_CACHE: KVNamespace;
  GREEN_STATE: KVNamespace;
  ORACLE_API_KEY: string;
}

export async function syncMarketCache(env: Env, ctx?: ExecutionContext): Promise<void> {
  const CACHE_KEY = 'latest_prices';
  const MAX_AGE = 30; // Fresh for 30 seconds
  const STALE_WHILE_REVALIDATE = 300; // Stale but acceptable for up to 5 mins

  const now = Date.now();
  const { value, metadata } = await env.MARKET_CACHE.getWithMetadata(CACHE_KEY);

  if (value && metadata && (metadata as any).updated_at) {
    const age = (now - (metadata as any).updated_at) / 1000;
    if (age < MAX_AGE) {
      console.log(`[MARKET_WATCHER] Cache is fresh (${age.toFixed(1)}s old). Skipping sync.`);
      return;
    } else {
      console.log(`[MARKET_WATCHER] Cache is stale (${age.toFixed(1)}s old). Revalidating...`);
    }
  }

  try {
    const assets = ['BTC', 'ETH', 'SOL'];
    const results: any = {};
    for (const asset of assets) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch("https://api.anny.trade/backend/anny-line/chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asset, interval: "1d", tradeMarket: "USDT" }),
          signal: controller.signal as any
        });
        clearTimeout(timeoutId);

        if (res.status === 429) {
           throw { status: 429, retryAfter: res.headers.get('Retry-After') };
        }
        if (!res.ok) {
           throw new Error(`Failed to fetch ${asset} from anny.trade: ${res.status}`);
        }
        const data = await res.json() as any;

        const chartData = data?.payload?.data;
        if (chartData && chartData.length > 0) {
          const latest = chartData[chartData.length - 1];

          let change_24h = 0;
          if (chartData.length >= 2) {
            const prev = chartData[chartData.length - 2];
            change_24h = ((latest.close - prev.close) / prev.close) * 100;
          }

          results[asset] = {
             price: latest.close,
             cfo_state: latest.state,
             change_24h: change_24h,
             high_24h: latest.high,
             low_24h: latest.low
          };
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        throw err;
      }
    }

    const multiSourceData = {
      crypto: results,
      _telemetry_timestamp: Date.now(),
      provider: "anny_trade_rest",
      upstreamLive: true
    };

    let circuitBreakerTriggered = false;
    let worstAsset = "";
    let worstDrop = 0;

    for (const [asset, data] of Object.entries(results)) {
       const change = (data as any).change_24h;
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

    await env.MARKET_CACHE.put(CACHE_KEY, JSON.stringify(multiSourceData), {
      expirationTtl: MAX_AGE + STALE_WHILE_REVALIDATE,
      metadata: { updated_at: Date.now() }
    });

    console.log(`[MARKET_WATCHER] Market cache updated at ${new Date().toISOString()}`);

  } catch (error: any) {
    if (error.status === 429) {
      console.warn(`[ORACLE_RATE_LIMIT] 429 received from oracle. Preserving cached prices. Retry-After: ${error.retryAfter || 'unknown'}`);
    } else {
      console.error(`[MARKET_WATCHER] Oracle fetch failed:`, error);
    }

    try {
      const { value, metadata } = await env.MARKET_CACHE.getWithMetadata(CACHE_KEY);
      if (value) {
        const parsedFallback = JSON.parse(value as string);
        parsedFallback.upstreamLive = false;
        await env.MARKET_CACHE.put(CACHE_KEY, JSON.stringify(parsedFallback), {
          expirationTtl: MAX_AGE + STALE_WHILE_REVALIDATE,
          metadata: { ...(metadata as object), rate_limited: error.status === 429, fallback: true }
        });
        console.log(`[MARKET_WATCHER] Fallback to stale cache successful`);
      }
    } catch (fallbackError) {
      console.error(`[MARKET_WATCHER] Fallback also failed:`, fallbackError);
    }
  }
}

export async function fetchHealth(env: Env, request: Request, ctx: ExecutionContext): Promise<Response> {
  if (ctx) ctx.waitUntil((async () => {
    try {
      if ((env as any).SUPABASE_URL && (env as any).SUPABASE_SERVICE_KEY) {
        await fetch(`${(env as any).SUPABASE_URL}/rest/v1/api_usage_logs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(env as any).SUPABASE_SERVICE_KEY}`,
            apikey: (env as any).SUPABASE_SERVICE_KEY,
          },
          body: JSON.stringify({
            endpoint: "/api/health",
            status_code: 200,
            error_message: null,
            count: 1,
          }),
        });
      }
    } catch (e) {
      console.error("Failed to log to api_usage_logs from health check:", e);
    }
  })());

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Axim-Signature",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  let kvHits = parseInt(await env.GREEN_STATE.get("telemetry_kv_hits") || "0", 10);
  let kvMisses = parseInt(await env.GREEN_STATE.get("telemetry_kv_misses") || "0", 10);
  const ratio = kvHits + kvMisses > 0 ? (kvHits / (kvHits + kvMisses)).toFixed(2) : "1.00";

  return new Response(JSON.stringify({
    status: "ok",
    data: [{
      worker_region: (request as any).cf?.colo || 'DEV',
      kv_cache_ratio: ratio,
      module: "market_watcher"
    }],
    latencyMs: 0,
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}
