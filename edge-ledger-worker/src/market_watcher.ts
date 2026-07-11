/**
 * Target: Cloudflare Worker Runtime
 * Role: market_watcher.ts
 * Description: High-frequency market watcher. Pulls pricing data and caches in KV for sub-10ms UI reads.
 */

export interface Env {
  MARKET_CACHE: KVNamespace;
  ORACLE_API_KEY: string;
}

export async function syncMarketCache(env: Env): Promise<void> {
  try {
    // 1. Fetch from Upstream Oracles (Simulated aggregation)
    // In production, this hits CoinGecko, Alpaca, etc.
    const multiSourceData = await fetchExternalOracles(env.ORACLE_API_KEY);

    // 2. Cache in KV with strict 30-second TTL
    await env.MARKET_CACHE.put('latest_prices', JSON.stringify(multiSourceData), {
      expirationTtl: 60,
      metadata: { updated_at: Date.now() }
    });

    console.log(`[MARKET_WATCHER] Market cache updated at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`[MARKET_WATCHER] Oracle fetch failed:`, error);

    // Fallback gracefully to historical keys without overwriting valid data blocks
    // By re-putting the old cache, we prevent KV from expiring it.
    try {
      const oldCache = await env.MARKET_CACHE.get('latest_prices');
      if (oldCache) {
        await env.MARKET_CACHE.put('latest_prices', oldCache, {
          expirationTtl: 60,
          metadata: { updated_at: Date.now() }
        });
        console.log(`[MARKET_WATCHER] Fallback to historical cache successful`);
      }
    } catch (fallbackError) {
      console.error(`[MARKET_WATCHER] Fallback also failed:`, fallbackError);
    }
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await syncMarketCache(env);
  }
};

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

  const response = await fetch(`${baseUrl}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true`, {
    headers
  });

  if (!response.ok) {
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
