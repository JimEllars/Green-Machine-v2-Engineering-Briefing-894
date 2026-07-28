import type { ExecutionContext } from '@cloudflare/workers-types';
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
  GREEN_STATE: any; // DLQ Namespace
  MARKET_CACHE: any;
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

export async function getOrRefreshAnnySessionToken(env: Env, ctx?: ExecutionContext): Promise<string> {
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

        const authTelemetry = {
          last_renewed: Date.now(),
          expires_at: Date.now() + 518400000, // 6 days
          status: "VALID",
          mode: env.ANNY_AUTH_MODE || "session-token"
        };
        await env.GREEN_STATE.put("anny_auth_telemetry", JSON.stringify(authTelemetry));

        return data.payload.token;
      } else {
        const authTelemetry = {
          last_renewed: Date.now(),
          expires_at: Date.now() + 518400000, // 6 days
          status: "LOGIN_FAILED",
          mode: env.ANNY_AUTH_MODE || "session-token"
        };
        await env.GREEN_STATE.put("anny_auth_telemetry", JSON.stringify(authTelemetry));
      }
    } catch (e) {
      console.error("Anny login auto-refresh failed", e);
      const authTelemetry = {
          last_renewed: Date.now(),
          expires_at: Date.now() + 518400000,
          status: "LOGIN_FAILED",
          mode: env.ANNY_AUTH_MODE || "session-token"
      };
      await env.GREEN_STATE.put("anny_auth_telemetry", JSON.stringify(authTelemetry));
    }
  }
  return "";
}

export async function annyBackendPost(path: string, body: unknown, env: Env, ctx?: ExecutionContext) {
  const token = await getOrRefreshAnnySessionToken(env, ctx);
  const auth: AnnyAuthConfig = {
    mode: env.ANNY_AUTH_MODE || "session-token",
    token: token
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.token) {
    Object.assign(headers, annyAuthHeaders(auth));
  }


  try {
    const res = await fetch(`https://api.anny.trade${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
       throw { status: res.status, message: `API Error: ${res.statusText}` };
    }

    const data = await res.json() as any;
    if (data?.result?.type === "UNAUTHORIZED") {
      await env.GREEN_STATE.delete("anny_session_token");
      throw new Error(`Anny auth rejected on ${path} — cleared stale session token`);
    }
    return data.payload;
  } catch (error: any) {
    if (ctx) {
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
              endpoint: path,
              status_code: error.status || 500,
              error_message: error.message || String(error),
              count: 1
            })
          });
        } catch (e) {
          console.error('Failed to log to api_usage_aggregates:', e);
        }
      })());
    }
    throw error;
  }
}



export async function fetchAnnyCombinedPortfolio(env: Env, ctx?: ExecutionContext) {
  try {
    const token = await getOrRefreshAnnySessionToken(env, ctx);
    const auth: AnnyAuthConfig = { mode: env.ANNY_AUTH_MODE || "session-token", token: token };
    const headers = { "Content-Type": "application/json" };
    if (auth.token) {
      Object.assign(headers, annyAuthHeaders(auth));
    }

    const positionsRes = await fetch("https://api.anny.trade/backend/activepositions", { headers });
    let activePositions = [];
    if (positionsRes.ok) {
      const data = await positionsRes.json() as any;
      activePositions = data?.payload || [];
    }

    let portfolioAssets = [];
    try {
      const portfolioData = await annyBackendPost('/backend/anny-line/portfolio', {}, env, ctx);
      portfolioAssets = portfolioData?.assets || portfolioData?.data?.assets || [];
    } catch (e) {
      console.error("Failed to fetch portfolio assets for merge", e);
    }

    const merged: Record<string, any> = {};

    for (const p of portfolioAssets) {
      const symbol = p.coin || p.symbol;
      if (!symbol) continue;
      merged[symbol] = {
        coin: symbol,
        quantity: p.quantity || p.balance || 0,
        currentPrice: p.currentPrice || p.price || 0,
        pnl: p.pnl || 0,
        cfo_state: p.cfo_state || p.cfo || 'wait'
      };
    }

    for (const p of activePositions) {
      const symbol = p.coin || p.symbol;
      if (!symbol) continue;

      if (!merged[symbol]) {
        merged[symbol] = {
          coin: symbol,
          quantity: 0,
          currentPrice: 0,
          pnl: 0,
          cfo_state: 'wait'
        };
      }

      merged[symbol].quantity = (merged[symbol].quantity || 0) + (p.quantity || p.position_size || p.size || 0);
      if (p.pnl || p.profit) {
         merged[symbol].pnl = (merged[symbol].pnl || 0) + (p.pnl || p.profit || 0);
      }
      if (p.currentPrice || p.price) {
          merged[symbol].currentPrice = p.currentPrice || p.price;
      }
    }

    const mergedArray = Object.values(merged);
    await env.GREEN_STATE.put('anny_portfolio_summary', JSON.stringify(mergedArray), { expirationTtl: 300, metadata: { updated_at: Date.now() } });
    return mergedArray;

  } catch (e) {
    console.error("fetchAnnyCombinedPortfolio failed", e);
  }
  return null;
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

    const prevTelemetryRaw = await env.GREEN_STATE.get("emailit_telemetry");
    let prevTelemetry = {};
    if (prevTelemetryRaw) {
        try { prevTelemetry = JSON.parse(prevTelemetryRaw); } catch(e) {}
    }
    const telemetry: any = {
       ...prevTelemetry,
       last_attempt: Date.now(),
       status: result.success ? "OK" : "ERROR",
       last_error: result.error || null
    };
    if (result.success) {
        telemetry.last_successful_dispatch = Date.now();
        telemetry.recipients = typeof params.to === 'string' ? params.to : (Array.isArray(params.to) ? (params.to as any[]).map((r: any) => r.email || r).join(', ') : '');
    }
    await env.GREEN_STATE.put("emailit_telemetry", JSON.stringify(telemetry));

    if (!result.success && !params._retryId) {
        await env.GREEN_STATE.put(`email_retry_queue:${Date.now()}`, JSON.stringify(params), { expirationTtl: 86400 });
    }
    return result;
  } catch (err: any) {
    const errorStr = err.message || "EmailIt dispatch failed";
    const prevTelemetryRaw = await env.GREEN_STATE.get("emailit_telemetry");
    let prevTelemetry = {};
    if (prevTelemetryRaw) {
        try { prevTelemetry = JSON.parse(prevTelemetryRaw); } catch(e) {}
    }
    const telemetry = {
       ...prevTelemetry,
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

  async scheduled(event: any, env: any, ctx: any): Promise<void> {
    if (event.cron === "* * * * *") {
        ctx.waitUntil((async () => {
          try {
            let cursor = undefined;
            let listComplete = false;
            while (!listComplete) {
              const retryList = await env.GREEN_STATE.list({ prefix: "audit_retry_queue:", cursor }) as any;
              for (const key of retryList.keys) {
                const rawPayload = await env.GREEN_STATE.get(key.name);
                if (rawPayload) {
                  try {
                    let parsedPayload = JSON.parse(rawPayload);
                    let retryCount = parsedPayload.retry_count || 0;
                    if (retryCount >= 5) {
                        await env.GREEN_STATE.put(`quarantine_retry:${Date.now()}_${Math.random().toString(36).substring(7)}`, rawPayload, { expirationTtl: 604800 });
                        await env.GREEN_STATE.delete(key.name);
                        continue;
                    }
                    parsedPayload.retry_count = retryCount + 1;
                    await env.GREEN_STATE.put(key.name, JSON.stringify(parsedPayload), { expirationTtl: 86400 });

                    const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_aggregates`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                        "apikey": env.SUPABASE_SERVICE_KEY
                      },
                      body: rawPayload
                    });
                    if (dbRes.ok) {
                      await env.GREEN_STATE.delete(key.name);
                    }
                  } catch (e) {
                    console.error("Failed to retry audit log post", e);
                  }
                }
              }
              if (retryList.list_complete) {
                listComplete = true;
              } else {
                cursor = retryList.cursor;
              }
            }
          } catch (e) {
            console.error("Audit log retry cron failed", e);
          }
        })());
    }

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

            // Filter 24h window
            const nowTime = Date.now();
            const filteredKeys = (deptSummaryList as any).keys.filter((key: any) => {
                const parts = key.name.split(':');
                const tsStr = parts[2];
                if (tsStr) {
                    const ts = parseInt(tsStr, 10);
                    if (!isNaN(ts) && nowTime - ts <= 86400000) {
                        return true;
                    }
                }
                return false;
            });

            for (const key of filteredKeys) {
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
                <head>
                  <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #e2e8f0; max-width: 600px; margin: 0 auto; padding: 20px; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { padding: 12px; border: 1px solid #334155; text-align: left; }
                    a { color: #34d399; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                  </style>
                </head>
                <body>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                    <tr>
                      <td style="padding: 20px;">
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

                      </td>
                    </tr>
                  </table>
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
                        let params = JSON.parse(val);
                        let retryCount = params.retry_count || 0;
                        if (retryCount >= 5) {
                            await env.GREEN_STATE.put(`quarantine_retry:${Date.now()}_${Math.random().toString(36).substring(7)}`, val, { expirationTtl: 604800 });
                            await env.GREEN_STATE.delete(key.name);
                            continue;
                        }
                        params.retry_count = retryCount + 1;
                        await env.GREEN_STATE.put(key.name, JSON.stringify(params), { expirationTtl: 86400 });

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

        ctx.waitUntil((async () => {
            try {
                const pSummary = await env.GREEN_STATE.getWithMetadata('anny_portfolio_summary');
                const lastUpdated = pSummary.metadata?.updated_at;
                if (!lastUpdated || (Date.now() - lastUpdated) > 240000) {
                    await fetchAnnyCombinedPortfolio(env, ctx);
                }
            } catch(e) {
                console.error('Failed to pre-warm anny_portfolio_summary', e);
            }
        })());
        ctx.waitUntil(syncMarketCache(env));


    }
  },

  async fetch(request: any, env: any, ctx: any): Promise<Response> {
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

        let execGovernance = { last_briefing_sent: null, hitl_status: 'ACTIVE', pending_retries: 0 };
        if (emailitTelemetry) {
            execGovernance.last_briefing_sent = emailitTelemetry.last_attempt;
        }
        try {
            const emailRetryList = await env.GREEN_STATE.list({ prefix: 'email_retry_queue:' });
            const auditRetryList = await env.GREEN_STATE.list({ prefix: 'audit_retry_queue:' });
            execGovernance.pending_retries = (emailRetryList as any).keys.length + (auditRetryList as any).keys.length;
        } catch(e) {}

        const nowD = new Date();
        const nextBriefing = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate(), 10, 30, 0));
        if (nowD.getTime() > nextBriefing.getTime()) {
            nextBriefing.setUTCDate(nextBriefing.getUTCDate() + 1);
        }
        const diffMs = nextBriefing.getTime() - nowD.getTime();
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        (execGovernance as any).next_briefing_countdown = `Next Briefing in ${diffHrs}h ${diffMins}m`;

        return new Response(JSON.stringify({
           success: true,
           buffered_count: bufferedCount,
           quarantined_count: quarantinedCount,
           emailit_telemetry: emailitTelemetry,
           exec_governance: execGovernance,
           pending_queue_count: execGovernance.pending_retries,
           emailit_configured: Boolean(env.EMAILIT_API_KEY),
           anny_oracle: {
             status: "active",
             session_valid: Boolean(await env.GREEN_STATE.get('anny_session_token')),
             mode: env.ANNY_AUTH_MODE || "session-token"
           },
           anny_auth_telemetry: await env.GREEN_STATE.get('anny_auth_telemetry', { type: 'json' })
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, private',
            'Server-Timing': `worker;dur=${duration};desc="Cloudflare Edge Execution"`,
            ...corsHeaders
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to read DLQ status' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/dept-summary') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }
      try {
        const deptSummaryList = await env.GREEN_STATE.list({ prefix: 'dept_summary:' });
        const summaries = [];
        const nowTime = Date.now();

        for (const key of (deptSummaryList as any).keys) {
            const parts = key.name.split(':');
            const tsStr = parts[2];
            if (tsStr) {
                const ts = parseInt(tsStr, 10);
                if (!isNaN(ts) && nowTime - ts <= 86400000) {
                    const val = await env.GREEN_STATE.get(key.name);
                    if (val) {
                        try {
                            summaries.push(JSON.parse(val));
                        } catch(e) {}
                    }
                }
            }
        }
        return new Response(JSON.stringify({ success: true, summaries }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: 'Failed to retrieve department summaries' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    if (request.method === 'DELETE' && url.pathname === '/api/admin/dept-summary') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      const department = url.searchParams.get('department');
      if (!department) {
        return new Response(JSON.stringify({ error: 'Department parameter is required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }

      try {
        const deptPrefix = `dept_summary:${department.toLowerCase()}:`;
        let cursor = undefined;
        let listComplete = false;
        while (!listComplete) {
          const listRes = await env.GREEN_STATE.list({ prefix: deptPrefix, cursor }) as any;
          for (const key of listRes.keys) {
            await env.GREEN_STATE.delete(key.name);
          }
          if (listRes.list_complete) {
            listComplete = true;
          } else {
            cursor = listRes.cursor;
          }
        }
        return new Response(JSON.stringify({ success: true, purged: department }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: 'Failed to purge department summary', details: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/dept-summary') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        const payload = await request.json() as { department: string, updatesCompleted: string[], activeWork: string[], questions: string[] };
        const { department, updatesCompleted, activeWork, questions } = payload;

        if (!department) {
           return new Response(JSON.stringify({ error: 'Department is required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
        }

        const keyName = `dept_summary:${department.toLowerCase()}:${Date.now()}`;
        await env.GREEN_STATE.put(keyName, JSON.stringify({
            department,
            updatesCompleted: updatesCompleted || [],
            activeWork: activeWork || [],
            questions: questions || [],
            timestamp: Date.now()
        }), { expirationTtl: 172800 });

        return new Response(JSON.stringify({ success: true, key: keyName }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e: any) {
         return new Response(JSON.stringify({ error: 'Failed to process department summary' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
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
              const html = `<html><head><style>body { font-family: sans-serif; background: #000; color: #fff; padding: 2rem; }</style></head><body><h2>Unauthorized Edge Ingress</h2></body></html>`;
              return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
          }
          try {
              let actionName = action;
              if (action === 'flush_dlq') {
                 // Trigger DLQ Flush routine inline (abstracted logic or simple loop)
                 let cursor = undefined;
                 let listComplete = false;
                 let processedCount = 0;
                 const MAX_PROCESS = 50;
                 while (!listComplete && processedCount < MAX_PROCESS) {
                   const dlqList = await env.GREEN_STATE.list({ cursor }) as any;
                   for (const key of dlqList.keys) {
                     if (processedCount >= MAX_PROCESS) break;
                     if (key.name.startsWith('quarantine:') || key.name === 'emailit_telemetry' || key.name.startsWith('exec_feedback:') || key.name.startsWith('admin_action:')) continue;

                     const rawPayload = await env.GREEN_STATE.get(key.name);
                     if (rawPayload) {
                       try {
                         const payload = JSON.parse(rawPayload);
                         const enrichedPayload = { ...payload, metadata: { ...(payload.metadata || {}), is_dlq_retry: true, retry_timestamp: Date.now() } };

                         // Simulate ingestion
                         await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions?on_conflict=transaction_hash`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                              'apikey': env.SUPABASE_SERVICE_KEY,
                              'Prefer': 'resolution=merge-duplicates'
                            },
                            body: JSON.stringify([enrichedPayload])
                         });
                         await env.GREEN_STATE.delete(key.name);
                         processedCount++;
                       } catch (e) {
                         await env.GREEN_STATE.put(`quarantine:${key.name}`, rawPayload, { metadata: { quarantine_reason: 'retry_failed', original_key: key.name } });
                         await env.GREEN_STATE.delete(key.name);
                       }
                     }
                   }
                   if (dlqList.list_complete) {
                     listComplete = true;
                   } else {
                     cursor = dlqList.cursor;
                   }
                 }
                 actionName = 'Flush DLQ Buffer';
              } else if (action === 'purge_quarantine') {
                 let cursor = undefined;
                 let listComplete = false;
                 while (!listComplete) {
                   const listRes = await env.GREEN_STATE.list({ prefix: 'quarantine:', cursor }) as any;
                   for (const key of listRes.keys) {
                     await env.GREEN_STATE.delete(key.name);
                   }
                   if (listRes.list_complete) {
                     listComplete = true;
                   } else {
                     cursor = listRes.cursor;
                   }
                 }
                 actionName = 'Purge Quarantine';
              } else if (action === 'acknowledge_plan') {
                 actionName = 'Acknowledge Strategic Plan';
                 // Acknowledge logic could just be dropping a state marker
              } else if (action === 'approve_payout') {
                 actionName = 'Approve Pending Payout Batch';
              }

              const actionId = `admin_action:${action}:${Date.now()}`;
              await env.GREEN_STATE.put(actionId, JSON.stringify({ action, timestamp: Date.now(), executed: true }), {
                  expirationTtl: 604800
              });

              // Log Executive HITL Action Executions to Supabase Audit Table
              ctx.waitUntil((async () => {
                const auditPayload = {
                  endpoint: "hitl_action_executed",
                  request_count: 1,
                  error_count: 0,
                  metadata: {
                    action: actionName,
                    executed_at: new Date().toISOString(),
                    executor: "james.ellars@axim.us.com"
                  }
                };
                try {
                  const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_aggregates`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                      'apikey': env.SUPABASE_SERVICE_KEY
                    },
                    body: JSON.stringify(auditPayload)
                  });
                  if (!dbRes.ok) throw new Error("DB Error");
                } catch (e) {
                  console.error('Failed to log HITL action execution:', e);
                  await env.GREEN_STATE.put(`audit_retry_queue:${Date.now()}`, JSON.stringify(auditPayload), { expirationTtl: 86400 });
                }
              })());

              if (request.method === 'GET') {
                  const html = `
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <meta charset="utf-8">
                    <title>Action Executed</title>
                    <style>
                      body {
                        margin: 0;
                        padding: 0;
                        background-color: #0f172a;
                        color: #f8fafc;
                        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                      }
                      .glass-panel {
                        background: rgba(30, 41, 59, 0.7);
                        backdrop-filter: blur(12px);
                        -webkit-backdrop-filter: blur(12px);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 16px;
                        padding: 40px;
                        text-align: center;
                        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                        max-width: 600px;
                        width: 90%;
                      }
                      .success-icon {
                        width: 64px;
                        height: 64px;
                        background: rgba(16, 185, 129, 0.1);
                        border: 1px solid rgba(16, 185, 129, 0.2);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0 auto 24px;
                        color: #10b981;
                      }
                      .success-icon svg {
                        width: 32px;
                        height: 32px;
                      }
                      h2 {
                        margin: 0 0 16px;
                        font-size: 24px;
                        font-weight: 600;
                        letter-spacing: -0.025em;
                      }
                      p {
                        color: #94a3b8;
                        margin: 0 0 24px;
                        font-size: 16px;
                        line-height: 1.5;
                      }
                      .status-pill {
                        display: inline-block;
                        padding: 4px 12px;
                        background: rgba(16, 185, 129, 0.1);
                        border: 1px solid rgba(16, 185, 129, 0.2);
                        color: #10b981;
                        border-radius: 9999px;
                        font-size: 12px;
                        font-weight: 600;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                      }
                    </style>
                  </head>
                  <body>
                    <div class="glass-panel">
                      <div class="success-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <h2>AXiM Executive Governance &mdash; Action Executed Successfully: ${actionName}</h2>
                      <p>The requested administrative task has been processed by the Green Machine edge worker.</p>
                      <div class="status-pill">Status: Operational</div>
                    </div>
                  </body>
                  </html>
                  `;
                  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
              }
              return new Response(JSON.stringify({ success: true, action_executed: action }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          } catch(e: any) {
              return new Response(JSON.stringify({ error: 'Action execution failed', details: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
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
                          <head>
                            <style>
                              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #e2e8f0; max-width: 600px; margin: 0 auto; padding: 20px; }
                              table { width: 100%; border-collapse: collapse; }
                              th, td { padding: 12px; border: 1px solid #334155; text-align: left; }
                            </style>
                          </head>
                          <body>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                              <tr>
                                <td style="padding: 20px;">
                            <h2>Executive Directive Acknowledged</h2>
                            <p>Thank you, Mr. Ellars.</p>
                            <p>Your guidance has been successfully ingested and will be injected into active AI strategy prompts.</p>
                                </td>
                              </tr>
                            </table>
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

        // Filter 24h window
        const nowTime = Date.now();
        const filteredKeys = (deptSummaryList as any).keys.filter((key: any) => {
            const parts = key.name.split(':');
            const tsStr = parts[2];
            if (tsStr) {
                const ts = parseInt(tsStr, 10);
                if (!isNaN(ts) && nowTime - ts <= 86400000) {
                    return true;
                }
            }
            return false;
        });

        for (const key of filteredKeys) {
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

            let combinedPortfolio = null;
            const pSummaryRaw = await env.GREEN_STATE.get('anny_portfolio_summary', { type: 'json' });
            if (pSummaryRaw) {
                combinedPortfolio = pSummaryRaw;
            } else {
                combinedPortfolio = await fetchAnnyCombinedPortfolio(env, ctx);
            }


            if (combinedPortfolio && combinedPortfolio.length > 0) {
                let accCount = 0;
                let waitCount = 0;
                let distCount = 0;
                let activePositionsHtml = '';

                for (const asset of combinedPortfolio) {
                    const cfo = asset.cfo_state || '';
                    if (cfo.toLowerCase() === 'accumulate') accCount++;
                    else if (cfo.toLowerCase() === 'distribute') distCount++;
                    else waitCount++; // Default to wait/neutral

                    if (asset.quantity > 0 || asset.pnl !== 0) {
                        activePositionsHtml += `<li><strong>${asset.coin}</strong>: Qty ${asset.quantity} | PNL: $${asset.pnl} | State: ${cfo}</li>`;
                    }
                }

                portfolioSummaryHtml = `<div style="border: 1px solid #10b981; padding: 15px; border-radius: 8px; margin-bottom: 20px; background-color: #f0fdf4;">
                    <h4 style="color: #047857; margin-top: 0;">Anny Combined Portfolio & Active Positions</h4>
                    <p style="margin-bottom: 10px;"><strong>${accCount}</strong> Accumulate | <strong>${waitCount}</strong> Neutral (Wait) | <strong>${distCount}</strong> Distribute</p>
                    ${activePositionsHtml ? `<ul>${activePositionsHtml}</ul>` : ''}
                </div>`;
            }
        } catch(e) {
            console.error('Failed to fetch combined portfolio for briefing', e);
        }

        const html = `
          <html>
            <head>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #e2e8f0; max-width: 600px; margin: 0 auto; padding: 20px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 12px; border: 1px solid #334155; text-align: left; }
                a { color: #34d399; text-decoration: none; }
                a:hover { text-decoration: underline; }
              </style>
            </head>
            <body>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                <tr>
                  <td style="padding: 20px;">
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
                  </td>
                </tr>
              </table>
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
            'Cache-Control': 'no-store, private',
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
          'Cache-Control': 'public, max-age=15, stale-while-revalidate=45',
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
            'Cache-Control': 'no-store, private',
            ...corsHeaders
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to purge quarantine' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }



    if (request.method === 'POST' && url.pathname === '/api/admin/renew-anny-session') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        await env.GREEN_STATE.delete('anny_session_token');
        const newToken = await getOrRefreshAnnySessionToken(env, ctx);
        const authTelemetryRaw = await env.GREEN_STATE.get('anny_auth_telemetry', { type: 'json' });
        return new Response(JSON.stringify({ success: true, new_token_issued: Boolean(newToken), telemetry: authTelemetryRaw }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: 'Failed to renew session', details: err.message }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
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

        let response;
        let isFallback = false;
        try {
          response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
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
        } catch (primaryErr) {
          console.warn('[AI_FALLBACK] Primary model failed, failing over to Mistral 7B:', primaryErr);
          isFallback = true;
          response = await env.AI.run('@cf/mistral/mistral-7b-instruct-v0.2', {
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' }
          });
        }

        let parsed = typeof response.response === 'string' ? JSON.parse(response.response) : response.response;
        const duration = Math.round(performance.now() - startTime);
        const aiModel = isFallback ? 'mistral-7b' : 'llama-3.1';
        const serverTiming = isFallback ? `workers-ai-fallback;dur=${duration};ai_model=${aiModel}` : `worker;dur=${duration};desc="Cloudflare Edge Execution";ai_model=${aiModel}`;

        return new Response(JSON.stringify({ success: true, data: parsed, ai_model: aiModel }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'Server-Timing': serverTiming, ...corsHeaders } });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'AI Evaluation Failed' }), { status: 500, headers: corsHeaders });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/circuit-breaker-reset') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        const resetState = { state: 'CLOSED', failure_count: 0, last_failure: 0 };
        await env.GREEN_STATE.put('oracle_circuit_breaker', JSON.stringify(resetState));
        return new Response(JSON.stringify({ success: true, message: 'Oracle Circuit Reset to CLOSED' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to reset oracle circuit' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
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
        },
        anny_auth_telemetry: await env.GREEN_STATE.get('anny_auth_telemetry', { type: 'json' })
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=15, stale-while-revalidate=45',
          ...corsHeaders
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/quarantine-retry-purge') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        let listResult = await env.GREEN_STATE.list({ prefix: 'quarantine_retry:' });
        let purgedCount = 0;

        while (true) {
          if (listResult.keys.length > 0) {
            const deletePromises = listResult.keys.map((key: any) => env.GREEN_STATE.delete(key.name));
            await Promise.all(deletePromises);
            purgedCount += listResult.keys.length;
          }
          if (listResult.list_complete) break;
          listResult = await env.GREEN_STATE.list({ prefix: 'quarantine_retry:', cursor: listResult.cursor });
        }

        return new Response(JSON.stringify({ success: true, purged_count: purgedCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to purge quarantined retries' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Explicit Fallback Route Evaluation
    if (
        url.pathname !== '/' &&
        url.pathname !== '/api/dlq-status' &&
        url.pathname !== '/api/cache-sync' &&
        url.pathname !== '/api/admin/dept-summary' &&
        url.pathname !== '/api/admin/send-exec-briefing' &&
        url.pathname !== '/api/webhooks/emailit-inbound' &&
        url.pathname !== '/api/dlq-flush' &&
        url.pathname !== '/api/market-cache' &&
        url.pathname !== '/api/strategy-consult' &&
        url.pathname !== '/api/quarantine-purge' &&
        url.pathname !== '/api/health' &&
        url.pathname !== '/api/admin/renew-anny-session' && url.pathname !== '/api/admin/quarantine-retry-purge'
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
