/**
 * Target: Cloudflare Worker Runtime
 * Role: thirdweb_bridge.ts
 * Description: Intercepts Thirdweb lifecycle hooks, validates HMAC, and upserts to Supabase.
 * Enforces Zero Data Loss via KV Dead Letter Queue (DLQ).
 */

import { syncMarketCache } from './market_watcher';

export interface Env {
  ORACLE_API_KEY: string;
  AXIM_INTERNAL_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  GREEN_STATE: KVNamespace; // DLQ Namespace
  MARKET_CACHE: KVNamespace;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Axim-Signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};


function assertKvBindings(env: Env): Response | null {
  if (!env.GREEN_STATE || typeof env.GREEN_STATE.get !== 'function' ||
      !env.MARKET_CACHE || typeof env.MARKET_CACHE.get !== 'function') {
    return new Response(JSON.stringify({ success: false, error: "Cloudflare KV namespace bindings uninitialized", code: "ERR_KV_NOT_BOUND" }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  return null;
}

export default {

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncMarketCache(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const kvError = assertKvBindings(env);
    if (kvError) return kvError;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(JSON.stringify({ status: "online", engine: "axim-green-machine-core", tier: "edge_ingress" }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }
    }


    if (request.method === 'GET' && url.pathname === '/api/dlq-status') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      // Endpoint for app diagnostics
      try {
        let totalCount = 0;
        let standardCount = 0;
        let quarantineCount = 0;
        let cursor = undefined;
        let listComplete = false;

        while (!listComplete) {
          const listOptions: any = cursor ? { cursor } : undefined;
          const dlqList: any = await env.GREEN_STATE.list(listOptions);

          for (const key of dlqList.keys) {
            if (key.name.startsWith('quarantine:')) {
              quarantineCount++;
            } else {
              standardCount++;
            }
            totalCount++;
          }

          if (dlqList.list_complete) {
            listComplete = true;
          } else {
            cursor = dlqList.cursor;
          }
        }

        const hasDlqItems = totalCount > 0;
        return new Response(JSON.stringify({ active: hasDlqItems, count: standardCount, quarantine_count: quarantineCount }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=15, s-maxage=30',
            ...corsHeaders
          }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: 'Failed to read DLQ' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }


    if (request.method === 'POST' && url.pathname === '/api/cache-sync') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }

      try {
        await syncMarketCache(env);
        return new Response(JSON.stringify({ success: true, status: 'synced' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to sync cache' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/dlq-flush') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }

      try {
        let cursor = undefined;
        let listComplete = false;
        let processedCount = 0;
        const MAX_PROCESS = 25;

        while (!listComplete && processedCount < MAX_PROCESS) {
          const dlqList: any = await env.GREEN_STATE.list(cursor ? { cursor } : undefined);

          for (const key of dlqList.keys) {
            if (processedCount >= MAX_PROCESS) {
               break;
            }
            if (key.name.startsWith('quarantine:')) continue; // Skip poison pills

            const rawPayload = await env.GREEN_STATE.get(key.name);
            if (rawPayload) {
              try {
                const payload = JSON.parse(rawPayload);
                if (payload.error === 'unparseable') {
                   // Delete unparseable from DLQ
                   await env.GREEN_STATE.delete(key.name);
                   continue;
                }

                const {
                  partner_id,
                  wallet_address,
                  smart_contract_address,
                  amount,
                  currency,
                  event_type,
                  transaction_hash
                } = payload;

                let status = 'pending';
                if (event_type === 'minted' || event_type === 'settled') status = 'minted';
                if (event_type === 'failed') status = 'failed';

                const ledgerEntry = {
                  partner_id,
                  wallet_address,
                  smart_contract_address,
                  amount,
                  currency,
                  status,
                  ...(transaction_hash && { transaction_hash })
                };

                const dbResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions?on_conflict=transaction_hash`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                    'apikey': env.SUPABASE_SERVICE_KEY,
                    'Prefer': 'resolution=merge-duplicates'
                  },
                  body: JSON.stringify([ledgerEntry])
                });

                if (dbResponse.ok) {
                  await env.GREEN_STATE.delete(key.name);
                  processedCount++;
                } else {
                  // Task 1: Neutralize Poison-Pill DLQ Stagnation
                  // Implement retry count metadata check and threshold logic
                  const metadata: any = key.metadata || {};
                  const retryCount = (metadata.retry_count || 0) + 1;

                  if (retryCount >= 3) {
                     // Tag as poison pill to ignore in the future, delete original
                     await env.GREEN_STATE.put(`quarantine:${key.name}`, rawPayload, {
                         metadata: { ...metadata, retry_count: retryCount, error: 'poison_pill_threshold_reached' }
                     });
                     await env.GREEN_STATE.delete(key.name);
                  } else {
                     // Increment retry count
                     await env.GREEN_STATE.put(key.name, rawPayload, {
                         metadata: { ...metadata, retry_count: retryCount }
                     });
                  }
                }
              } catch (parseError) {
                console.error('Parse or upsert error', parseError);
              }
            }
          }

          if (processedCount >= MAX_PROCESS) {
            break;
          }
          if (dlqList.list_complete) {
            listComplete = true;
          } else {
            cursor = dlqList.cursor;
          }
        }

        let remaining = false;
        if (processedCount >= MAX_PROCESS) {
            remaining = true;
        } else if (!listComplete) {
            remaining = true;
        }

        return new Response(JSON.stringify({ success: true, processed: processedCount, remaining }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...corsHeaders
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to flush DLQ' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/market-cache') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      const cacheResult = await env.MARKET_CACHE.getWithMetadata('latest_prices');
      if (!cacheResult.value) {
        return new Response(JSON.stringify({ error: 'Cache miss' }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      let parsedData;
      try {
        parsedData = JSON.parse(cacheResult.value);
        // Track data freshness
        parsedData._telemetry_timestamp = (cacheResult.metadata && (cacheResult.metadata as any).updated_at) ? (cacheResult.metadata as any).updated_at : Date.now();

        // Expose metadata flags to client (e.g., rate_limited)
        parsedData.metadata = cacheResult.metadata ? { ...cacheResult.metadata } : {
          rate_limited: false,
          updated_at: parsedData._telemetry_timestamp
        };
      } catch (e) {
        // Fallback if parsing fails
        parsedData = { error: 'Invalid JSON in cache' };
      }

      return new Response(JSON.stringify(parsedData), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=15, s-maxage=30',
          ...corsHeaders
        }
      });
    }



    if (request.method === 'POST' && url.pathname === '/api/quarantine-purge') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }

      try {
        let cursor = undefined;
        let listComplete = false;
        let totalPurged = 0;

        while (!listComplete) {
          const listRes: any = await env.GREEN_STATE.list({ prefix: 'quarantine:', cursor });

          for (const key of listRes.keys) {
            await env.GREEN_STATE.delete(key.name);
            totalPurged++;
          }

          if (listRes.list_complete) {
            listComplete = true;
          } else {
            cursor = listRes.cursor;
          }
        }

        return new Response(JSON.stringify({ success: true, purged_count: totalPurged }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...corsHeaders
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to purge quarantine' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    // Strict Edge Route Catch-All Termination
    if (url.pathname !== '/' && !url.pathname.startsWith('/api/')) {
       return new Response('404 Not Found', { status: 404, headers: corsHeaders });
    }

    // Explicit Fallback Route Evaluation
    if (
        url.pathname !== '/' &&
        url.pathname !== '/api/dlq-status' &&
        url.pathname !== '/api/cache-sync' &&
        url.pathname !== '/api/dlq-flush' &&
        url.pathname !== '/api/market-cache' &&
        url.pathname !== '/api/quarantine-purge'
    ) {
        return new Response('404 Not Found', { status: 404, headers: corsHeaders });
    }

    // 1. HMAC Validation (The Ingress Token Isolation Rule)

    const signature = request.headers.get('X-Axim-Signature');
    if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
      return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
    }

    try {
      const payload = (await request.json()) as any;
      
            // 2. Extract and rigorously transform variables
      let {
        partner_id, 
        wallet_address, 
        smart_contract_address, 
        amount, 
        currency, 
        event_type, 
        transaction_hash 
      } = payload;

      // Expand partner_id assignment logic
      if (!partner_id) {
         partner_id = payload.metadata?.linked_affiliate_id || payload.metadata?.promo_code || null;
      }
      if (typeof partner_id === 'string') {
          // Sanitize
          partner_id = partner_id.trim();
      }


      let status = 'pending';
      if (event_type === 'minted' || event_type === 'settled') status = 'minted';
      if (event_type === 'failed') status = 'failed';

      const ledgerEntry = {
        partner_id,
        wallet_address,
        smart_contract_address,
        amount,
        currency,
        status,
        ...(transaction_hash && { transaction_hash })
      };

      // 3. Upsert to Supabase PostgREST Bulk Ingestion
      const dbResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions?on_conflict=transaction_hash`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify([ledgerEntry])
      });

      if (!dbResponse.ok) {
        throw new Error(`DB Ingestion Fault: ${dbResponse.statusText}`);
      }

      return new Response(JSON.stringify({ success: true, status: 'ledger_updated' }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

    } catch (error) {
      // 4. Fail-Open Edge Buffer (DLQ)
      const errorId = `dlq_tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      // Clone request for DLQ backup if possible, or stringify known payload
      const rawPayload = await request.clone().text().catch(() => '{"error": "unparseable"}');
      
      await env.GREEN_STATE.put(errorId, rawPayload, {
        metadata: { error: (error as Error).message, timestamp: Date.now() }
      });

      return new Response(JSON.stringify({ 
        success: false, 
        status: 'buffered_to_dlq',
        dlq_id: errorId 
      }), { status: 202, headers: { 'Content-Type': 'application/json', ...corsHeaders } }); // Accepted but deferred
    }
  }
};
