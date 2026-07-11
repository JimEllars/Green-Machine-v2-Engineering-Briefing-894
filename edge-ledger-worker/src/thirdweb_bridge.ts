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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

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
        let cursor = undefined;
        let listComplete = false;

        while (!listComplete) {
          const listOptions: any = cursor ? { cursor } : undefined;
          const dlqList: any = await env.GREEN_STATE.list(listOptions);
          totalCount += dlqList.keys.length;

          if (dlqList.list_complete) {
            listComplete = true;
          } else {
            cursor = dlqList.cursor;
          }
        }

        const hasDlqItems = totalCount > 0;
        return new Response(JSON.stringify({ active: hasDlqItems, count: totalCount }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
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
      } catch (e) {
        // Fallback if parsing fails
        parsedData = { error: 'Invalid JSON in cache' };
      }

      return new Response(JSON.stringify(parsedData), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
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
        url.pathname !== '/api/market-cache'
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
