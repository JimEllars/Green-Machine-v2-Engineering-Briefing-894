import { syncMarketCache } from './market_watcher';

export interface Env {
  ANNY_AUTH_MODE?: "session-token" | "bearer-pat";
  ANNY_AUTH_TOKEN?: string;
  ANNY_EMAIL?: string;
  ANNY_PASSWORD?: string;
  EMAILIT_API_KEY?: string;
  ORACLE_API_KEY: string;
  AXIM_INTERNAL_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  GREEN_STATE: KVNamespace; // DLQ Namespace
  MARKET_CACHE: KVNamespace;
  AI: any;
}


export type AnnyAuthMode = "session-token" | "bearer-pat";

export interface AnnyAuthConfig {
  mode: AnnyAuthMode;
  token: string;
}

export function annyAuthHeaders(auth: AnnyAuthConfig): Record<string, string> {
  return auth.mode === "session-token"
    ? { "session-token": auth.token }
    : { "Authorization": `Bearer ${auth.token}` };
}

export async function getOrRefreshAnnySessionToken(env: Env): Promise<string> {
  if (env.ANNY_AUTH_TOKEN) return env.ANNY_AUTH_TOKEN;

  const cachedToken = await env.GREEN_STATE.get("anny_session_token");
  if (cachedToken) return cachedToken;

  if (env.ANNY_EMAIL && env.ANNY_PASSWORD) {
    try {
      const res = await fetch("https://api.anny.trade/backend/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: env.ANNY_EMAIL, password: env.ANNY_PASSWORD })
      });
      const data = await res.json() as any;
      if (data?.payload?.token) {
        await env.GREEN_STATE.put("anny_session_token", data.payload.token, { expirationTtl: 518400 }); // 6-day TTL
        return data.payload.token;
      }
    } catch (e) {
      console.error("Anny login auto-refresh failed", e);
    }
  }
  return "";
}

export async function annyBackendPost(path: string, body: unknown, env: Env) {
  const token = await getOrRefreshAnnySessionToken(env);
  const auth: AnnyAuthConfig = {
    mode: env.ANNY_AUTH_MODE || "session-token",
    token: token
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.token) {
    Object.assign(headers, annyAuthHeaders(auth));
  }

  const res = await fetch(`https://api.anny.trade${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json() as any;
  if (data?.result?.type === "UNAUTHORIZED") {
    await env.GREEN_STATE.delete("anny_session_token");
    throw new Error(`Anny auth rejected on ${path} — cleared stale session token`);
  }
  return data.payload;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Axim-Signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function sendEmailItNotification(
  params: { to: string; cc?: string[]; subject: string; html: string; text?: string; _retryId?: string },
  env: Env
): Promise<{ success: boolean; error?: string }> {
  if (!env.EMAILIT_API_KEY) {
    return { success: false, error: "EMAILIT_API_KEY not configured" };
  }
  try {
    const response = await fetchWithTimeout("https://api.emailit.com/v1/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.EMAILIT_API_KEY}`
      },
      body: JSON.stringify({
        from: "Green Machine <system@axim.us.com>",
        to: [params.to],
        ...(params.cc && { cc: params.cc }),
        subject: params.subject,
        html: params.html,
        text: params.text || ""
      })
    });
    let result: { success: boolean; error?: string };
    if (!response.ok) {
      const errText = await response.text();
      result = { success: false, error: `EmailIt HTTP ${response.status}: ${errText}` };
    } else {
      result = { success: true };
    }

    const telemetry = {
       last_attempt: Date.now(),
       status: result.success ? "OK" : "ERROR",
       last_error: result.error || null
    };
    await env.GREEN_STATE.put("emailit_telemetry", JSON.stringify(telemetry));

    if (!result.success && !params._retryId) {
        await env.GREEN_STATE.put(`email_retry_queue:${Date.now()}`, JSON.stringify(params), { expirationTtl: 86400 });
    }
    return result;
  } catch (err: any) {
    const errorStr = err.message || "EmailIt dispatch failed";
    const telemetry = {
       last_attempt: Date.now(),
       status: "ERROR",
       last_error: errorStr
    };
    await env.GREEN_STATE.put("emailit_telemetry", JSON.stringify(telemetry));
    if (!params._retryId) {
        await env.GREEN_STATE.put(`email_retry_queue:${Date.now()}`, JSON.stringify(params), { expirationTtl: 86400 });
    }
    return { success: false, error: errorStr };
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

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "30 10 * * *") {
        ctx.waitUntil((async () => {
          try {
            const cacheResult = await env.MARKET_CACHE.getWithMetadata('latest_prices');
            let parsedData: any = {};
            if (cacheResult.value) {
                try {
                    parsedData = JSON.parse(cacheResult.value as string);
                } catch (e) { console.error('Parse error', e); }
            }

            const dlqList = await env.GREEN_STATE.list({ limit: 1000 });
            let bufferedCount = dlqList.keys.filter((k: any) => !k.name.startsWith('quarantine:')).length;
            let quarantinedCount = dlqList.keys.filter((k: any) => k.name.startsWith('quarantine:')).length;

            const deptSummaryList = await env.GREEN_STATE.list({ prefix: 'dept_summary:' });
            let deptSummariesHtml = '<ul>';
            for (const key of (deptSummaryList as any).keys) {
                const val = await env.GREEN_STATE.get(key.name);
                if (val) {
                    try {
                        const p = JSON.parse(val);
                        const d = p.departmentName || p.department || p.name || 'Unknown';
                        const c = p.completedUpdates || p.completed || 'N/A';
                        const a = p.activeWork || p.active || 'N/A';
                        deptSummariesHtml += `<li>Ecosystem Department Progress: ${d} &mdash; ${c} &amp; ${a}</li>`;
                    } catch(e) {
                        deptSummariesHtml += `<li>Ecosystem Department Progress: ${val}</li>`;
                    }
                }
            }
            deptSummariesHtml += '</ul>';

            const btc = parsedData?.crypto?.BTC?.price || 'N/A';
            const eth = parsedData?.crypto?.ETH?.price || 'N/A';
            const sol = parsedData?.crypto?.SOL?.price || 'N/A';

            const html = `
              <html>
                <head><style>body { font-family: sans-serif; }</style></head>
                <body>
                  <h2>Executive Daily Briefing</h2>
                  <h3>App Development Progress Summary</h3>
                  <p>Sprint 1.8: Dual Executive Recipients, Pre-5am CST CRON, Departmental Aggregation & HITL Action Links is active.</p>
                  <h3>Departmental Progress</h3>
                  ${deptSummariesHtml}
                  <h3>System Work & Operations Summary</h3>
                  <ul>
                    <li>DLQ Buffered Count: ${bufferedCount}</li>
                    <li>Quarantined Count: ${quarantinedCount}</li>
                    <li>Market Cache - BTC: ${btc}, ETH: ${eth}, SOL: ${sol}</li>
                  </ul>

                  <h3>Executive Inquiry & Action Block</h3>
                  <p>Please reply directly to this email to provide feedback or inquiries.</p>
                  <p><b>Administrative Actions:</b></p>
                  <ul>
                    <li><a href="https://green-machine-edge-ledger.jules.workers.dev/api/webhooks/emailit-inbound?action=approve_payout&token=${env.AXIM_INTERNAL_KEY}">Approve Pending Payout Batch</a></li>
                    <li><a href="https://green-machine-edge-ledger.jules.workers.dev/api/webhooks/emailit-inbound?action=acknowledge_plan&token=${env.AXIM_INTERNAL_KEY}">Acknowledge Strategic Plan</a></li>
                  </ul>

                </body>
              </html>
            `;

            const dispatchResult = await sendEmailItNotification({
                to: "james.ellars@axim.us.com",
                cc: ["jrellars@gmail.com"],
                subject: "AXiM Executive Briefing & Departmental Summary — Green Machine v2",
                html: html
            }, env);

            const execFeedbacks = await env.GREEN_STATE.list({ prefix: 'exec_feedback:' });
            let prunedCount = 0;
            const now = Date.now();
            for (const key of (execFeedbacks as any).keys) {
                const parts = key.name.split(':');
                const tsStr = parts[1];
                if (tsStr) {
                    const ts = parseInt(tsStr, 10);
                    if (now - ts > 604800000) {
                        await env.GREEN_STATE.delete(key.name);
                        prunedCount++;
                    }
                }
            }
            console.log(`Pruned ${prunedCount} stale executive feedbacks.`);

          } catch (err) {
            console.error("Scheduled briefing error", err);
          }
        })());
    } else {


        ctx.waitUntil((async () => {
            const retryList = await env.GREEN_STATE.list({ prefix: 'email_retry_queue:' });
            for (const key of (retryList as any).keys) {
                const val = await env.GREEN_STATE.get(key.name);
                if (val) {
                    try {
                        const params = JSON.parse(val);
                        params._retryId = key.name;
                        const res = await sendEmailItNotification(params, env);
                        if (res.success) {
                            await env.GREEN_STATE.delete(key.name);
                        }
                    } catch (e) {
                        console.error('Retry error', e);
                    }
                }
            }
        })());
        ctx.waitUntil(syncMarketCache(env));

    }
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
        let bufferedCount = dlqList.keys.filter((k: any) => !k.name.startsWith('quarantine:') && k.name !== 'emailit_telemetry' && !k.name.startsWith('exec_feedback:')).length;
        let quarantinedCount = dlqList.keys.filter((k: any) => k.name.startsWith('quarantine:')).length;

        let emailitTelemetry = null;
        try {
            const telemetryRaw = await env.GREEN_STATE.get('emailit_telemetry');
            if (telemetryRaw) {
                emailitTelemetry = JSON.parse(telemetryRaw);
            }
        } catch (e) {
            console.error('Failed to parse emailit telemetry', e);
        }

        const duration = Math.round(performance.now() - startTime);
        return new Response(JSON.stringify({
           success: true,
           buffered_count: bufferedCount,
           quarantined_count: quarantinedCount,
           emailit_telemetry: emailitTelemetry,
           emailit_configured: Boolean(env.EMAILIT_API_KEY),
           anny_oracle: {
             status: "active",
             session_valid: Boolean(await env.GREEN_STATE.get('anny_session_token')),
             mode: env.ANNY_AUTH_MODE || "session-token"
           }
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

    if ((request.method === 'POST' || request.method === 'GET') && url.pathname === '/api/webhooks/emailit-inbound') {
      const action = url.searchParams.get('action');
      const token = url.searchParams.get('token');

      if (action) {
          if (token !== env.AXIM_INTERNAL_KEY) {
              return new Response('Unauthorized Action Token', { status: 401, headers: corsHeaders });
          }
          try {
              const actionId = `admin_action:${action}:${Date.now()}`;
              await env.GREEN_STATE.put(actionId, JSON.stringify({ action, timestamp: Date.now(), executed: true }), {
                  expirationTtl: 604800
              });

              if (request.method === 'GET') {
                  return new Response(
                    `<html><body><h2>Action '${action}' successfully executed.</h2></body></html>`,
                    { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } }
                  );
              }
              return new Response(JSON.stringify({ success: true, action_executed: action }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          } catch(e) {
              return new Response(JSON.stringify({ error: 'Action execution failed' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
          }
      }

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

        ctx.waitUntil((async () => {
            try {
                await sendEmailItNotification({
                    to: "james.ellars@axim.us.com",
                    subject: "Directive Received & Ingested — AXiM Green Machine AI",
                    html: `
                        <html>
                          <head><style>body { font-family: sans-serif; }</style></head>
                          <body>
                            <h2>Executive Directive Acknowledged</h2>
                            <p>Thank you, Mr. Ellars.</p>
                            <p>Your guidance has been successfully ingested and will be injected into active AI strategy prompts.</p>
                          </body>
                        </html>
                    `
                }, env);
            } catch (err) {
                console.error("Failed to send auto-reply receipt", err);
            }
        })());

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
        let bufferedCount = dlqList.keys.filter((k: any) => !k.name.startsWith('quarantine:')).length;
        let quarantinedCount = dlqList.keys.filter((k: any) => k.name.startsWith('quarantine:')).length;

        const deptSummaryList = await env.GREEN_STATE.list({ prefix: 'dept_summary:' });
        let deptSummariesHtml = '<ul>';
        for (const key of (deptSummaryList as any).keys) {
            const val = await env.GREEN_STATE.get(key.name);
            if (val) {
                try {
                    const p = JSON.parse(val);
                    const d = p.departmentName || p.department || p.name || 'Unknown';
                    const c = p.completedUpdates || p.completed || 'N/A';
                    const a = p.activeWork || p.active || 'N/A';
                    deptSummariesHtml += `<li>Ecosystem Department Progress: ${d} &mdash; ${c} &amp; ${a}</li>`;
                } catch(e) {
                    deptSummariesHtml += `<li>Ecosystem Department Progress: ${val}</li>`;
                }
            }
        }
        deptSummariesHtml += '</ul>';

        const btc = parsedData?.crypto?.BTC?.price || 'N/A';
        const eth = parsedData?.crypto?.ETH?.price || 'N/A';
        const sol = parsedData?.crypto?.SOL?.price || 'N/A';

        let portfolioSummaryHtml = '';
        try {
            const portfolioRes = await annyBackendPost('/backend/anny-line/portfolio', {}, env);
            if (portfolioRes && portfolioRes.data) {
                let accCount = 0;
                let waitCount = 0;
                let distCount = 0;

                const assets = portfolioRes.data.assets || [];
                for (const asset of assets) {
                    const cfo = asset.cfo_state || asset.cfo || '';
                    if (cfo.toLowerCase() === 'accumulate') accCount++;
                    else if (cfo.toLowerCase() === 'distribute') distCount++;
                    else waitCount++; // Default to wait/neutral
                }

                portfolioSummaryHtml = `<div style="border: 1px solid #10b981; padding: 15px; border-radius: 8px; margin-bottom: 20px; background-color: #f0fdf4;">
                    <h4 style="color: #047857; margin-top: 0;">Anny Portfolio Structure</h4>
                    <p style="margin-bottom: 0;"><strong>${accCount}</strong> Accumulate | <strong>${waitCount}</strong> Neutral (Wait) | <strong>${distCount}</strong> Distribute</p>
                </div>`;
            }
        } catch(e) {
            console.error('Failed to fetch portfolio for briefing', e);
        }

        const html = `
          <html>
            <head><style>body { font-family: sans-serif; }</style></head>
            <body>
              <h2>Executive Daily Briefing</h2>
              ${portfolioSummaryHtml}
              <h3>App Development Progress Summary</h3>
              <p>Sprint 1.8: Dual Executive Recipients, Pre-5am CST CRON, Departmental Aggregation & HITL Action Links is active.</p>
                  <h3>Departmental Progress</h3>
                  ${deptSummariesHtml}
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
            cc: ["jrellars@gmail.com"],
                subject: "AXiM Executive Briefing & Departmental Summary — Green Machine v2",
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

          for (const key of (dlqList as any).keys) {
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


      parsedData.oracle_provider = "anny_trade_rest";
      parsedData.auth_mode = env.ANNY_AUTH_MODE || "session-token";
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

        let systemMessage = `You are the AXiM Green Machine Strategy Consultant. Current Market Context: [${marketContextString}]. Respond in strict JSON with fields: "analysis" (string), "riskLevel" (string: 'Low'|'Medium'|'High'|'Critical'), and "actionItems" (array of strings).`;

        const feedbackList = await env.GREEN_STATE.list({ prefix: 'exec_feedback:', limit: 1 });
        if (feedbackList.keys && feedbackList.keys.length > 0) {
          const feedbackContent = await env.GREEN_STATE.get(feedbackList.keys[0].name);
          if (feedbackContent) {
            systemMessage += ` Latest Executive Guidance from Mr. Ellars: [${feedbackContent}]. Incorporate this directive into your strategy evaluation.`;
          }
        }

        try {
          const riskController = new AbortController();
          const riskTimeout = setTimeout(() => riskController.abort(), 3000);
          const riskResponse = await fetch('https://api.anny.trade/v3/ai/assess_risk?coin=BTC&trade_market=USDT&trade_side=long', {
            signal: riskController.signal,
            headers: { 'Accept': 'application/json' }
          });
          clearTimeout(riskTimeout);

          if (riskResponse.ok) {
            const riskData = await riskResponse.json() as any;
            const riskProfile = riskData?.riskProfile || 'N/A';
            const adxStrength = riskData?.adx?.strength || 'N/A';
            const rsiValue = riskData?.rsiCross?.value || 'N/A';
            const macdValue = riskData?.macdCross?.value || 'N/A';

            systemMessage += ` Anny Risk Assessment (BTC): Profile=${riskProfile}, ADX=${adxStrength}, RSI=${rsiValue}, MACD=${macdValue}. Incorporate these momentum signals into your strategy response.`;
          }
        } catch (e) {
          console.warn("Anny risk assessment fallback triggered", e);
        }

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

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        environment: "production",
        cloudflareEdge: true,
        oracle_provider: "anny_trade_rest",
        auth_mode: env.ANNY_AUTH_MODE || "session-token",
        anny_oracle: {
          status: "active",
          session_valid: Boolean(await env.GREEN_STATE.get('anny_session_token')),
          mode: env.ANNY_AUTH_MODE || "session-token"
        }
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
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
        url.pathname !== '/api/quarantine-purge' &&
        url.pathname !== '/api/health'
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
      // Aggregate usage/errors asynchronously
      ctx.waitUntil((async () => {
        try {
          await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_aggregates`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_KEY
            },
            body: JSON.stringify({
              endpoint: url.pathname,
              status_code: 500,
              error_message: (error as Error).message,
              count: 1
            })
          });
        } catch (e) {
          console.error('Failed to log to api_usage_aggregates:', e);
        }
      })());

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
        error: (error as Error).message,
        dlq_id: errorId 
      }), { status: 202, headers: { 'Content-Type': 'application/json', ...corsHeaders } }); // Accepted but deferred
    }
  }
};
