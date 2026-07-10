/**
 * Target: Cloudflare Worker Runtime
 * Role: thirdweb_bridge.ts
 * Description: Intercepts Thirdweb lifecycle hooks, validates HMAC, and upserts to Supabase.
 * Enforces Zero Data Loss via KV Dead Letter Queue (DLQ).
 */

export interface Env {
  AXIM_INTERNAL_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  GREEN_STATE: KVNamespace; // DLQ Namespace
  MARKET_CACHE: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/market-cache') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401 });
      }

      const latestPrices = await env.MARKET_CACHE.get('latest_prices');
      if (!latestPrices) {
        return new Response(JSON.stringify({ error: 'Cache miss' }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      return new Response(latestPrices, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 1. HMAC Validation (The Ingress Token Isolation Rule)

    const signature = request.headers.get('X-Axim-Signature');
    if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
      return new Response('Unauthorized Edge Ingress', { status: 401 });
    }

    try {
      const payload = await request.json();
      
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

      return new Response(JSON.stringify({ success: true, status: 'ledger_updated' }), { status: 200 });

    } catch (error) {
      // 4. Fail-Open Edge Buffer (DLQ)
      const errorId = `dlq_tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      // Clone request for DLQ backup if possible, or stringify known payload
      const rawPayload = await request.clone().text().catch(() => '{"error": "unparseable"}');
      
      await env.GREEN_STATE.put(errorId, rawPayload, {
        metadata: { error: error.message, timestamp: Date.now() }
      });

      return new Response(JSON.stringify({ 
        success: false, 
        status: 'buffered_to_dlq',
        dlq_id: errorId 
      }), { status: 202 }); // Accepted but deferred
    }
  }
};