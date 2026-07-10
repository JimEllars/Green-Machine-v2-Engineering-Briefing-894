/**
 * Target: Cloudflare Worker Runtime
 * Role: market_watcher.ts
 * Description: High-frequency market watcher. Pulls pricing data and caches in KV for sub-10ms UI reads.
 */

export interface Env {
  MARKET_CACHE: KVNamespace;
  ORACLE_API_KEY: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      // 1. Fetch from Upstream Oracles (Simulated aggregation)
      // In production, this hits CoinGecko, Alpaca, etc.
      const multiSourceData = await fetchExternalOracles(env.ORACLE_API_KEY);
      
      // 2. Cache in KV with strict 30-second TTL
      await env.MARKET_CACHE.put('latest_prices', JSON.stringify(multiSourceData), {
        expirationTtl: 60 // Minimum CF KV TTL is 60s, but we update every 30s via cron
      });
      
      console.log(`[MARKET_WATCHER] Market cache updated at ${new Date().toISOString()}`);
    } catch (error) {
      console.error(`[MARKET_WATCHER] Oracle fetch failed:`, error);
    }
  }
};

async function fetchExternalOracles(apiKey: string) {
  // Mocking external oracle response for the architectural blueprint
  return {
    timestamp: Date.now(),
    crypto: {
      BTC: { price: 64230.50, change_24h: 2.4 },
      ETH: { price: 3450.20, change_24h: -1.2 },
      SOL: { price: 145.80, change_24h: 5.6 }
    },
    equities: {
      AAPL: { price: 189.45, change_24h: 0.8 },
      MSFT: { price: 420.15, change_24h: 1.1 }
    }
  };
}