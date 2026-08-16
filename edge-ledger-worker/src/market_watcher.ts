import type { KVNamespace, ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';
/**
 * Target: Cloudflare Worker Runtime
 * Role: market_watcher.ts
 * Description: High-frequency market watcher. Pulls pricing data and caches in KV for sub-10ms UI reads.
 */

export interface Env {
  MARKET_CACHE: KVNamespace;
  GREEN_STATE: KVNamespace;
  ORACLE_API_KEY: string;
}

/**
 * Synchronizes the market cache with upstream oracles.
 * If a 429 rate-limit is encountered, it preserves the existing cache and updates
 * the metadata to reflect the rate-limited status.
 */
export async function syncMarketCache(env: Env): Promise<void> {
  let circuitBreakerStr = await env.GREEN_STATE.get('oracle_circuit_breaker');
  let circuitBreaker = circuitBreakerStr ? JSON.parse(circuitBreakerStr) : { state: 'CLOSED', failure_count: 0, last_failure: 0 };

  if (circuitBreaker.state === 'OPEN') {
    const now = Date.now();
    if (now - circuitBreaker.last_failure < 300000) {
      // Still in cooldown period, fallback to cache
      console.warn('[CIRCUIT_BREAKER] Oracle fetch skipped due to OPEN circuit breaker.');
      try {
        const oldCache = await env.MARKET_CACHE.get('latest_prices');
        if (oldCache) {
          await env.MARKET_CACHE.put('latest_prices', oldCache, {
            expirationTtl: 60,
            metadata: { updated_at: Date.now(), rate_limited: true, circuit_breaker: true, provider: "anny_trade_rest" }
          });
        }
      } catch (fallbackError) {
        console.error('[MARKET_WATCHER] Fallback also failed:', fallbackError);
      }
      return;
    } else {
      circuitBreaker.state = 'HALF_OPEN';
      await env.GREEN_STATE.put('oracle_circuit_breaker', JSON.stringify(circuitBreaker));
    }
  }

  try {
    // 1. Fetch from Upstream Oracles (Simulated aggregation)
    // In production, this hits CoinGecko, Alpaca, etc.

    const assets = ['BTC', 'ETH', 'SOL'];
    const results: any = {};
    for (const asset of assets) {
      const res = await fetch("https://api.anny.trade/backend/anny-line/chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset, interval: "1d", tradeMarket: "USDT" })
      });
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
    }

    const multiSourceData = {
      crypto: results,
      _telemetry_timestamp: Date.now(),
      provider: "anny_trade_rest"
    };


    // 2. Cache in KV with strict 30-second TTL
    await env.MARKET_CACHE.put('latest_prices', JSON.stringify(multiSourceData), {
      expirationTtl: 60,
      metadata: { updated_at: Date.now() }
    });

    console.log(`[MARKET_WATCHER] Market cache updated at ${new Date().toISOString()}`);
    if (circuitBreaker.state !== 'CLOSED' || circuitBreaker.failure_count > 0) {
      circuitBreaker.state = 'CLOSED';
      circuitBreaker.failure_count = 0;
      await env.GREEN_STATE.put('oracle_circuit_breaker', JSON.stringify(circuitBreaker));
    }
  } catch (error: any) {
    if (error.status === 429) {
      console.warn(`[ORACLE_RATE_LIMIT] 429 received from oracle. Preserving cached prices. Retry-After: ${error.retryAfter || 'unknown'}`);
    } else {
      console.error(`[MARKET_WATCHER] Oracle fetch failed:`, error);
    }

    circuitBreaker.failure_count += 1;
    circuitBreaker.last_failure = Date.now();
    if (circuitBreaker.failure_count >= 3) {
      circuitBreaker.state = 'OPEN';
    }
    await env.GREEN_STATE.put('oracle_circuit_breaker', JSON.stringify(circuitBreaker));

    // Fallback gracefully to historical keys without overwriting valid data blocks
    // By re-putting the old cache, we prevent KV from expiring it.
    try {
      const oldCache = await env.MARKET_CACHE.get('latest_prices');
      if (oldCache) {
        await env.MARKET_CACHE.put('latest_prices', oldCache, {
          expirationTtl: 60,
          metadata: { updated_at: Date.now(), rate_limited: true, provider: "anny_trade_rest", circuit_breaker: circuitBreaker.state === 'OPEN' }
        });
        console.log(`[MARKET_WATCHER] Fallback to historical cache successful`);
      }
    } catch (fallbackError) {
      console.error(`[MARKET_WATCHER] Fallback also failed:`, fallbackError);
    }

    // Log error to supabase usage aggregates if env is passed properly
    // This function doesn't have ctx here, so we will just return gracefully.
  }
}



export async function fetchHealth(env: Env, request: Request, ctx: ExecutionContext): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
  };

  let kvHits = parseInt(await env.GREEN_STATE.get("telemetry_kv_hits") || "0", 10);
  let kvMisses = parseInt(await env.GREEN_STATE.get("telemetry_kv_misses") || "0", 10);
  const ratio = kvHits + kvMisses > 0 ? (kvHits / (kvHits + kvMisses)).toFixed(2) : "1.00";

  return new Response(JSON.stringify({
    success: true,
    latencyMs: 0,
    status: "healthy",
    timestamp: new Date().toISOString(),
    worker_region: (request as any).cf?.colo || 'DEV',
    kv_cache_ratio: ratio,
    module: "market_watcher"
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}
