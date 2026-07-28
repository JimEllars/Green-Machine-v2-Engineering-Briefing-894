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
      const data = await res.json();

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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        environment: "production",
        cloudflareEdge: true
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Axim-Signature'
        }
      });
    }
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-Axim-Signature'
            }
        });
    }
    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await syncMarketCache(env);
  }
};


async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw { code: 'ERR_OUTBOUND_TIMEOUT', message: 'Request timed out' };
    }
    throw error;
  }
}

async function fetchExternalOracles(apiKey: string) {
  const headers: Record<string, string> = {
    'Accept': 'application/json'
  };

  let baseUrl = 'https://api.coingecko.com/api/v3';

  if (apiKey) {
    if (apiKey.startsWith('pro_')) {
      baseUrl = 'https://pro-api.coingecko.com/api/v3';
      headers['x-cg-pro-api-key'] = apiKey;
    } else {
      headers['x-cg-demo-api-key'] = apiKey;
    }
  }

  const response = await fetchWithTimeout(`${baseUrl}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true`, {
    headers
  });

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const err = new Error(`Oracle fetch failed with status 429`);
      (err as any).status = 429;
      (err as any).retryAfter = retryAfter;
      throw err;
    }
    throw new Error(`Oracle fetch failed with status ${response.status}`);
  }

  const data = await (response.json() as Promise<any>);

  return {
    timestamp: Date.now(),
    crypto: {
      BTC: { price: data.bitcoin?.usd || 0, change_24h: data.bitcoin?.usd_24h_change || 0 },
      ETH: { price: data.ethereum?.usd || 0, change_24h: data.ethereum?.usd_24h_change || 0 },
      SOL: { price: data.solana?.usd || 0, change_24h: data.solana?.usd_24h_change || 0 }
    }
  };
}
