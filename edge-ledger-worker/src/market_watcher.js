/**
 * Synchronizes the market cache with upstream oracles.
 * If a 429 rate-limit is encountered, it preserves the existing cache and updates
 * the metadata to reflect the rate-limited status.
 */
export async function syncMarketCache(env) {
    const CACHE_KEY = 'latest_prices';
    const MAX_AGE = 30; // Fresh for 30 seconds
    const STALE_WHILE_REVALIDATE = 300; // Stale but acceptable for up to 5 mins
    const now = Date.now();
    const { value, metadata } = await env.MARKET_CACHE.getWithMetadata(CACHE_KEY);
    if (value && metadata && metadata.updated_at) {
        const age = (now - metadata.updated_at) / 1000;
        if (age < MAX_AGE) {
            console.log(`[MARKET_WATCHER] Cache is fresh (${age.toFixed(1)}s old). Skipping sync.`);
            return;
        }
        else {
            console.log(`[MARKET_WATCHER] Cache is stale (${age.toFixed(1)}s old). Revalidating...`);
        }
    }
    try {
        // 1. Fetch from Upstream Oracles (Simulated aggregation)
        const assets = ['BTC', 'ETH', 'SOL'];
        const results = {};
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
        // Cache in KV with strict 30-second TTL
        // In stale-while-revalidate, we could set a longer KV expiration
        // and store the 'freshness' in metadata, but KV expiration handles removal.
        await env.MARKET_CACHE.put(CACHE_KEY, JSON.stringify(multiSourceData), {
            expirationTtl: MAX_AGE + STALE_WHILE_REVALIDATE,
            metadata: { updated_at: Date.now() }
        });
        console.log(`[MARKET_WATCHER] Market cache updated at ${new Date().toISOString()}`);
    }
    catch (error) {
        if (error.status === 429) {
            console.warn(`[ORACLE_RATE_LIMIT] 429 received from oracle. Preserving cached prices. Retry-After: ${error.retryAfter || 'unknown'}`);
        }
        else {
            console.error(`[MARKET_WATCHER] Oracle fetch failed:`, error);
        }
        // Stale-While-Revalidate fallback
        try {
            const { value, metadata } = await env.MARKET_CACHE.getWithMetadata(CACHE_KEY);
            if (value) {
                // Prolong the existing stale cache
                await env.MARKET_CACHE.put(CACHE_KEY, value, {
                    expirationTtl: MAX_AGE + STALE_WHILE_REVALIDATE,
                    metadata: { ...metadata, rate_limited: error.status === 429, fallback: true }
                });
                console.log(`[MARKET_WATCHER] Fallback to stale cache successful`);
            }
        }
        catch (fallbackError) {
            console.error(`[MARKET_WATCHER] Fallback also failed:`, fallbackError);
        }
    }
}
export async function fetchHealth(env, request, ctx) {
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
                worker_region: request.cf?.colo || 'DEV',
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
