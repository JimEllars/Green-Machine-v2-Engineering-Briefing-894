import { syncMarketCache } from './market_watcher';

export interface Env {
  EMAILIT_API_KEY?: string;
  ORACLE_API_KEY: string;
  AXIM_INTERNAL_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  GREEN_STATE: KVNamespace; // DLQ Namespace
  MARKET_CACHE: KVNamespace;
  AI: any;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Axim-Signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};


async function sendEmailItNotification(
  params: { to: string; subject: string; html: string; text?: string },
  env: Env
): Promise<{ success: boolean; error?: string }> {
  if (!env.EMAILIT_API_KEY) {
    return { success: false, error: "EMAILIT_API_KEY not configured" };
  }
  try {
    const response = await fetch("https://api.emailit.com/v1/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.EMAILIT_API_KEY}`
      },
      body: JSON.stringify({
        from: "Green Machine <system@axim.us.com>",
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text || ""
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `EmailIt HTTP ${response.status}: ${errText}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "EmailIt dispatch failed" };
  }
}

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
    const startTime = performance.now();
    const kvError = assertKvBindings(env);
    if (kvError) return kvError;

    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === 'GET' && url.pathname === '/api/dlq-status') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }

      try {
        const dlqList = await env.GREEN_STATE.list({ limit: 1000 });
        let bufferedCount = dlqList.keys.filter(k => !k.name.startsWith('quarantine:')).length;
        let quarantinedCount = dlqList.keys.filter(k => k.name.startsWith('quarantine:')).length;

        const duration = Math.round(performance.now() - startTime);
        return new Response(JSON.stringify({
           success: true,
           buffered_count: bufferedCount,
           quarantined_count: quarantinedCount
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Server-Timing': `worker;dur=${duration};desc="Cloudflare Edge Execution"`,
            ...corsHeaders
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to read DLQ status' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/cache-sync') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      try {
          await syncMarketCache(env);
          return new Response(JSON.stringify({ success: true, message: 'Cache synced successfully' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
      } catch (e) {
          return new Response(JSON.stringify({ error: 'Failed to sync cache', details: (e as Error).message }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/webhooks/emailit-inbound') {
      try {
        const payload = await request.json() as any;
        const from = payload.from || 'unknown';
        const subject = payload.subject || 'No Subject';
        const text = payload.text || '';
        const responseToken = payload.response_token || '';

        const feedbackId = `exec_feedback:${Date.now()}`;
        await env.GREEN_STATE.put(feedbackId, JSON.stringify({ from, subject, text, responseToken, timestamp: Date.now() }), {
            expirationTtl: 604800 // 7 days
        });

        return new Response(JSON.stringify({ success: true, ingested: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to ingest inbound webhook' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/send-exec-briefing') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        const cacheResult = await env.MARKET_CACHE.getWithMetadata('latest_prices');
        let parsedData: any = {};
        if (cacheResult.value) {
            try {
                parsedData = JSON.parse(cacheResult.value);
            } catch (e) { console.error('Parse error', e); }
        }

        const dlqList = await env.GREEN_STATE.list({ limit: 1000 });
        let bufferedCount = dlqList.keys.filter(k => !k.name.startsWith('quarantine:')).length;
        let quarantinedCount = dlqList.keys.filter(k => k.name.startsWith('quarantine:')).length;

        const btc = parsedData?.crypto?.BTC?.price || 'N/A';
        const eth = parsedData?.crypto?.ETH?.price || 'N/A';
        const sol = parsedData?.crypto?.SOL?.price || 'N/A';

        const html = `
          <html>
            <head><style>body { font-family: sans-serif; }</style></head>
            <body>
              <h2>Executive Daily Briefing</h2>
              <h3>App Development Progress Summary</h3>
              <p>Sprint 1.3: Telemetry Integration & Polish is active.</p>
              <h3>System Work & Operations Summary</h3>
              <ul>
                <li>DLQ Buffered Count: ${bufferedCount}</li>
                <li>Quarantined Count: ${quarantinedCount}</li>
                <li>Market Cache - BTC: $${btc}, ETH: $${eth}, SOL: $${sol}</li>
              </ul>
              <h3>Executive Inquiry Block</h3>
              <p>Please reply directly to this email to provide feedback or inquiries.</p>
            </body>
          </html>
        `;

        const dispatchResult = await sendEmailItNotification({
            to: "james.ellars@axim.us.com",
            subject: "Daily Executive Briefing",
            html: html
        }, env);

        if (dispatchResult.success) {
            return new Response(JSON.stringify({ success: true, recipient: "james.ellars@axim.us.com" }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } else {
            return new Response(JSON.stringify({ error: dispatchResult.error }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to send exec briefing' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/dlq-flush') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }

      try {
        let processedCount = 0;
        const MAX_PROCESS = 50;

        let cursor = undefined;
        let listComplete = false;

        while (!listComplete && processedCount < MAX_PROCESS) {
          const dlqList: any = await env.GREEN_STATE.list({ cursor });

          for (const key of dlqList.keys) {
            if (processedCount >= MAX_PROCESS) break;
            if (key.name.startsWith('quarantine:')) continue; // Skip quarantined items

            const rawPayload = await env.GREEN_STATE.get(key.name);
            if (rawPayload) {
              try {
                const payload = JSON.parse(rawPayload);

                // Add retry flag to metadata
                const enrichedPayload = {
                   ...payload,
                   metadata: {
                     ...(payload.metadata || {}),
                     is_dlq_retry: true,
                     dlq_id: key.name
                   }
                };

                const dbResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions?on_conflict=transaction_hash`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                    'apikey': env.SUPABASE_SERVICE_KEY,
                    'Prefer': 'resolution=merge-duplicates'
                  },
                  body: JSON.stringify([enrichedPayload])
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

      const duration = Math.round(performance.now() - startTime);
      return new Response(JSON.stringify(parsedData), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=15, s-maxage=30',
          'Server-Timing': `worker;dur=${duration};desc="Cloudflare Edge Execution"`,
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


    if (request.method === 'POST' && url.pathname === '/api/strategy-consult') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      const { prompt, session_id } = await request.json() as any;

      if (!env.AI) {
        return new Response(JSON.stringify({ error: "AI binding not configured" }), { status: 503, headers: corsHeaders });
      }

      try {
        const marketCacheRaw = await env.MARKET_CACHE.get('latest_prices', { type: 'json' }) as any;
        let marketContextString = "";

        if (marketCacheRaw && marketCacheRaw.crypto) {
          const btc = marketCacheRaw.crypto.BTC?.price || 'N/A';
          const eth = marketCacheRaw.crypto.ETH?.price || 'N/A';
          const sol = marketCacheRaw.crypto.SOL?.price || 'N/A';
          marketContextString = `Live Telemetry: BTC: $${btc}, ETH: $${eth}, SOL: $${sol}`;
        }

        const systemMessage = `You are the AXiM Green Machine Strategy Consultant. Current Market Context: [${marketContextString}]. Respond in strict JSON with fields: "analysis" (string), "riskLevel" (string: 'Low'|'Medium'|'High'|'Critical'), and "actionItems" (array of strings).`;

        const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        }, {
          extraHeaders: {
            "x-session-affinity": `ses_${session_id || 'default'}`
          }
        });

        let parsed = typeof response.response === 'string' ? JSON.parse(response.response) : response.response;
        const duration = Math.round(performance.now() - startTime);
        return new Response(JSON.stringify({ success: true, data: parsed }), { status: 200, headers: { 'Content-Type': 'application/json', 'Server-Timing': `worker;dur=${duration};desc="Cloudflare Edge Execution"`, ...corsHeaders } });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'AI Evaluation Failed' }), { status: 500, headers: corsHeaders });
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
        url.pathname !== '/api/admin/send-exec-briefing' &&
        url.pathname !== '/api/webhooks/emailit-inbound' &&
        url.pathname !== '/api/dlq-flush' &&
        url.pathname !== '/api/market-cache' &&
        url.pathname !== '/api/strategy-consult' &&
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
