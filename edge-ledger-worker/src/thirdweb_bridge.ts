import type { ExecutionContext } from '@cloudflare/workers-types';
import { syncMarketCache } from './market_watcher';

export interface Env {
  SUPABASE_READ_URL?: string;
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


export const getSupabaseReadUrl = (env: Env) => env.SUPABASE_READ_URL || env.SUPABASE_URL;

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
      const res = await fetchWithRetry("https://api.anny.trade/backend/login", {
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
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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


async function fetchWithRetry(url: string, options: RequestInit, maxRetries: number = 2, timeoutMs: number = 5000): Promise<Response> {
  let lastError: any;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (!response.ok && response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (e: any) {
      lastError = e;
      if (i < maxRetries) {
        await new Promise(res => setTimeout(res, Math.pow(2, i) * 500));
      }
    }
  }
  throw lastError;
}

async function sendEmailItNotification(
  params: { to: string; cc?: string[]; subject: string; html: string; text?: string; _retryId?: string },
  env: Env
): Promise<{ success: boolean; error?: string }> {
  if (!env.EMAILIT_API_KEY) {
    return { success: false, error: "EMAILIT_API_KEY not configured" };
  }
  try {
    const startFetchTime = performance.now();
    const response = await fetchWithRetry("https://api.emailit.com/v1/emails", {
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

    const delivery_ms = Math.round(performance.now() - startFetchTime);

    try {
      let telemetryStr = await env.GREEN_STATE.get('emailit_telemetry') || '{}';
      let telemetry = JSON.parse(telemetryStr);
      telemetry.delivery_ms = delivery_ms;
      if (response.ok) {
        telemetry.status = 'OPERATIONAL';
        telemetry.last_successful_dispatch = Date.now();
      } else {
        telemetry.status = 'ERROR';
      }
      telemetry.last_attempt = Date.now();
      await env.GREEN_STATE.put('emailit_telemetry', JSON.stringify(telemetry));
    } catch (e) {}

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
        try { prevTelemetry = JSON.parse(prevTelemetryRaw); } catch(e) { console.error('Failed to parse prevTelemetryRaw'); }
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



async function trackEdgeRequest(env: any, isError: boolean, isRateLimit: boolean = false) {
    if (!env || !env.GREEN_STATE) return;
    try {
        const rawTelemetry = await env.GREEN_STATE.get('edge_error_telemetry');
        let telemetry = rawTelemetry ? JSON.parse(rawTelemetry) : {
            total_requests_24h: 0,
            total_errors_24h: 0,
            error_rate_pct: 0.0,
            last_error_timestamp: null,
            _tracking_start: Date.now()
        };

        const now = Date.now();
        // Reset every 24h
        if (now - (telemetry._tracking_start || now) > 86400000) {
           telemetry = {
               total_requests_24h: 0,
               total_errors_24h: 0,
               error_rate_pct: 0.0,
               last_error_timestamp: telemetry.last_error_timestamp,
               _tracking_start: now
           };
        }

        telemetry.total_requests_24h += 1;
        if (isError || isRateLimit) {
            telemetry.total_errors_24h += 1;
            telemetry.last_error_timestamp = now;
        }

        if (telemetry.total_requests_24h > 0) {
           telemetry.error_rate_pct = Number(((telemetry.total_errors_24h / telemetry.total_requests_24h) * 100).toFixed(2));
        }

        await env.GREEN_STATE.put('edge_error_telemetry', JSON.stringify(telemetry));
    } catch(e) {
        console.error("Failed to update edge_error_telemetry", e);
    }
}


    const logAdminAction = async (env: any, action: string, details: any) => {
        const timestamp = Date.now();
        const keyName = `admin_action_log:${timestamp}`;
        await env.GREEN_STATE.put(keyName, JSON.stringify({ action, timestamp, details }), { expirationTtl: 2592000 });
    };


function sanitizeTelemetry(data: any): any {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(item => sanitizeTelemetry(item));
  }

  if (typeof data === 'object') {
    const result: any = {};
    for (const key in data) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('axim_internal_key') ||
        lowerKey.includes('supabase_service_key') ||
        lowerKey.includes('emailit_api_key') ||
        lowerKey.includes('token')
      ) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitizeTelemetry(data[key]);
      }
    }
    return result;
  }
  return data;
}

export default {

  async scheduled(event: any, env: any, ctx: any): Promise<void> {
    if (event.cron === "* * * * *") {
        ctx.waitUntil((async () => {
          try {

            // DLQ Auto-Heal & Re-Queue
            try {
              const dbHealthRes = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
                headers: { 'apikey': env.SUPABASE_SERVICE_KEY }
              });
              if (dbHealthRes.ok) {
                const listResult = await env.GREEN_STATE.list({ prefix: 'audit_retry_queue:', limit: 10 });
                let healedCount = 0;
                for (const key of listResult.keys) {
                  try {
                    const payloadRaw = await env.GREEN_STATE.get(key.name);
                    if (payloadRaw) {
                      const payload = JSON.parse(payloadRaw);

                      const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_aggregates`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'apikey': env.SUPABASE_SERVICE_KEY,
                          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                          'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify(payload)
                      });

                      if (dbRes.ok || dbRes.status === 200 || dbRes.status === 201) {
                        await env.GREEN_STATE.delete(key.name);
                        healedCount++;
                      }
                    }
                  } catch (e) {}
                }

                await env.GREEN_STATE.put('dlq_autoheal_telemetry', JSON.stringify({
                  last_autoheal_run: Date.now(),
                  items_healed: healedCount,
                  status: "OPERATIONAL"
                }));
              }
            } catch (autoHealErr) {
              console.error('Auto-heal failed:', autoHealErr);
            }

            // Telemetry Pruning
            let prunedCount = 0;
            const now = Date.now();
            const oneDay = 86400000;
            const sevenDays = 604800000;

            const prunePrefix = async (prefix: string, maxAge: number) => {
                let cursor = undefined;
                let listComplete = false;
                while (!listComplete) {
                    const listResult = await env.GREEN_STATE.list({ prefix, cursor }) as any;
                    for (const key of listResult.keys) {
                        try {
                           // Try to extract timestamp from key or payload.
                           // Actually the prompt says "older than X". The keys often have timestamps.
                           const parts = key.name.split(':');
                           const tsStr = parts[parts.length - 1];
                           const tsMatch = tsStr.match(/^(\d+)$/);
                           let itemTime = 0;
                           if (tsMatch) {
                               itemTime = parseInt(tsMatch[1], 10);
                           } else {
                               const raw = await env.GREEN_STATE.get(key.name);
                               if (raw) {
                                   const data = JSON.parse(raw);
                                   if (data.timestamp) itemTime = data.timestamp;
                               }
                           }

                           if (itemTime && (now - itemTime > maxAge)) {
                               await env.GREEN_STATE.delete(key.name);
                               prunedCount++;
                           }
                        } catch(e) {}
                    }
                    listComplete = listResult.list_complete;
                    cursor = listResult.cursor;
                }
            };

            await prunePrefix('ai_consult_log:', oneDay);
            await prunePrefix('anny_signal_log:', sevenDays);
            await prunePrefix('exec_feedback:', sevenDays);

            await env.GREEN_STATE.put('kv_prune_telemetry', JSON.stringify({
                last_pruned: now,
                items_pruned: prunedCount,
                status: 'CLEAN'
            }));

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

            const signalListExec = await env.GREEN_STATE.list({ prefix: 'anny_signal_log:', limit: 1000 });
            let totalSignals = 0;
            let buyCount = 0;
            let tpCount = 0;
            let slCount = 0;
            let dcaCount = 0;

            const nowTimeSignal = Date.now();
            for (const key of (signalListExec as any).keys) {
                const parts = key.name.split(':');
                const tsStr = parts[1];
                if (tsStr) {
                    const ts = parseInt(tsStr, 10);
                    if (!isNaN(ts) && nowTimeSignal - ts <= 86400000) {
                        const signalRaw = await env.GREEN_STATE.get(key.name);
                        if (signalRaw) {
                            try {
                                const s = JSON.parse(signalRaw);
                                totalSignals++;
                                const act = (s.action || '').toLowerCase();
                                if (act === 'buy' || act === 'long') buyCount++;
                                else if (act === 'tp' || act === 'take_profit' || act === 'take-profit') tpCount++;
                                else if (act === 'sl' || act === 'stop_loss' || act === 'stop-loss') slCount++;
                                else if (act === 'dca') dcaCount++;
                            } catch(e) {}
                        }
                    }
                }
            }

            const signalSummaryHtml = totalSignals > 0
              ? `<div style="border: 1px solid #6366f1; padding: 15px; border-radius: 8px; margin-bottom: 20px; background-color: #eef2ff;">
                    <h4 style="color: #4338ca; margin-top: 0;">Anny 24h Signal Executions</h4>
                    <p style="margin-bottom: 0; font-weight: bold;">${totalSignals} total triggers (${buyCount} buys, ${tpCount} take-profits, ${slCount} stop-losses, ${dcaCount} DCAs)</p>
                 </div>`
              : `<div style="border: 1px solid #6366f1; padding: 15px; border-radius: 8px; margin-bottom: 20px; background-color: #eef2ff;">
                    <h4 style="color: #4338ca; margin-top: 0;">Anny 24h Signal Executions</h4>
                    <p style="margin-bottom: 0;">0 total triggers</p>
                 </div>`;

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
                  ${signalSummaryHtml}
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

    // Wrap the entire fetch in a try-catch and finally to track edge telemetry
    let isError = false;
    let isRateLimit = false;

    try {
        const response = await (async () => {


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
        let edgeErrorTelemetry = null;
        try {
            const errRaw = await env.GREEN_STATE.get('edge_error_telemetry');
            if (errRaw) edgeErrorTelemetry = JSON.parse(errRaw);
        } catch(e) {}
        try {
            const telemetryRaw = await env.GREEN_STATE.get('emailit_telemetry');
            if (telemetryRaw) {
                emailitTelemetry = JSON.parse(telemetryRaw);
            }
        } catch (e) {
            console.error('Failed to parse emailit telemetry', e);
        }

        let total_consultations_24h = 0;
        let risk_gates_passed = 0;
        let risk_warnings = 0;

        const consultList = dlqList.keys.filter((k: any) => k.name.startsWith('ai_consult_log:'));
        total_consultations_24h = consultList.length;
        for (const key of consultList) {
             try {
                 const logData = JSON.parse(await env.GREEN_STATE.get(key.name) || '{}');
                 if (logData.riskViolation) {
                     risk_warnings++;
                 } else {
                     risk_gates_passed++;
                 }
             } catch(e) {}
        }

        let total_inference_ms = 0;
        let count_ms = 0;
        let llama_count = 0;
        let mistral_count = 0;
        for (const key of consultList) {
            try {
                const logData = JSON.parse(await env.GREEN_STATE.get(key.name) || '{}');
                if (logData.ai_inference_ms) {
                    total_inference_ms += logData.ai_inference_ms;
                    count_ms++;
                }
                if (logData.model_used === 'mistral-7b') {
                    mistral_count++;
                } else {
                    llama_count++;
                }
            } catch(e) {}
        }
        let ai_inference_ms = count_ms > 0 ? Math.round(total_inference_ms / count_ms) : 0;
        let total_models = llama_count + mistral_count;
        let model_usage = {
           llama_3_1_pct: total_models > 0 ? (llama_count / total_models) * 100 : 0,
           mistral_7b_pct: total_models > 0 ? (mistral_count / total_models) * 100 : 0
        };

        const webhookIngressTelemetry = await env.GREEN_STATE.get('webhook_ingress_telemetry', { type: 'json' });
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

        let autohealTelemetry = null;
        try {
            const healRaw = await env.GREEN_STATE.get('dlq_autoheal_telemetry');
            if (healRaw) {
                autohealTelemetry = JSON.parse(healRaw);
            }
        } catch (e) {}

        return new Response(JSON.stringify(sanitizeTelemetry({
           success: true,
           buffered_count: bufferedCount,
           quarantined_count: quarantinedCount,
           emailit_telemetry: emailitTelemetry,
           autoheal_telemetry: autohealTelemetry,
           exec_governance: execGovernance,
           pending_queue_count: execGovernance.pending_retries,
           emailit_configured: Boolean(env.EMAILIT_API_KEY),
           investing_brain_telemetry: { total_consultations_24h, risk_gates_passed, risk_warnings, ai_inference_ms, model_usage },
           anny_oracle: {
             status: "active",
             session_valid: Boolean(await env.GREEN_STATE.get('anny_session_token')),
             mode: env.ANNY_AUTH_MODE || "session-token"
           },
           anny_auth_telemetry: await env.GREEN_STATE.get('anny_auth_telemetry', { type: 'json' })
        })), {
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

    if (request.method === 'GET' && url.pathname === '/api/admin/verify-deployment') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      try {
        const kv_green_state = !!env.GREEN_STATE;
        const kv_market_cache = !!env.MARKET_CACHE;
        const workers_ai = !!env.AI;
        const supabase_ledger = !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_KEY;
        const isOperational = kv_green_state && kv_market_cache && workers_ai && supabase_ledger;
        return new Response(JSON.stringify({
          success: true,
          deployment_status: isOperational ? 'OPERATIONAL' : 'DEGRADED',
          bindings: {
            kv_green_state,
            kv_market_cache,
            workers_ai,
            supabase_ledger
          },
          timestamp: Date.now()
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to verify deployment status' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
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
                        } catch(e) { console.error('Failed to execute'); }
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



    if (request.method === 'GET' && url.pathname === '/api/anny-signals') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        const signalList = await env.GREEN_STATE.list({ prefix: 'anny_signal_log:', limit: 10 });
        let signals = [];

        for (const key of signalList.keys) {
            const signalRaw = await env.GREEN_STATE.get(key.name);
            if (signalRaw) {
                try {
                    signals.push(JSON.parse(signalRaw));
                } catch(e) {}
            }
        }

        signals.sort((a, b) => b.timestamp - a.timestamp);

        return new Response(JSON.stringify({ success: true, data: signals.slice(0, 10) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to fetch anny signals' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/webhooks/anny-signal') {
      const signature = request.headers.get('X-Axim-Signature');
      const token = url.searchParams.get('token');

      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        if (!token || (token !== env.AXIM_INTERNAL_KEY && token !== (env as any).ANNY_AUTH_TOKEN)) {
           return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
        }
      }

      try {
        // Clone request so we can read text if JSON fails
        const reqClone = request.clone();
        try {
          const payload = await request.json() as any;
          const { symbol, action, price, bot_id, signal_id, timestamp } = payload;

          const keyName = `anny_signal_log:${Date.now()}`;
          const logData = {
            symbol: symbol || 'UNKNOWN',
            action: action || 'UNKNOWN',
            price: price || 0,
            bot_id: bot_id || 'N/A',
            signal_id: signal_id || 'N/A',
            timestamp: timestamp || Date.now(),
            received_at: Date.now()
          };

          await env.GREEN_STATE.put(keyName, JSON.stringify(logData), { expirationTtl: 604800 });

          // Task 3: Track Webhook Ingress Telemetry
          let ingressTelemetry = { last_webhook_received: Date.now(), total_webhooks_24h: 1, status: "OPERATIONAL" };
          try {
              const prevTelemetry = await env.GREEN_STATE.get('webhook_ingress_telemetry', { type: 'json' }) as any;
              if (prevTelemetry) {
                  ingressTelemetry.total_webhooks_24h = (prevTelemetry.total_webhooks_24h || 0) + 1;
              }
          } catch(e) {}
          await env.GREEN_STATE.put('webhook_ingress_telemetry', JSON.stringify(ingressTelemetry));

          return new Response(JSON.stringify({ success: true, status: 'signal_logged', log_id: keyName }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch (e: any) {
          const rawText = await reqClone.text();
          const keyName = `dlq_signal_${Date.now()}`;
          await env.GREEN_STATE.put(keyName, rawText, {
            metadata: { error: e.message, status: 'malformed_signal_buffered' }
          });
          return new Response(JSON.stringify({ success: false, status: 'buffered_to_dlq', dlq_id: keyName }), {
            status: 202,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      } catch (e: any) {
        return new Response(JSON.stringify({ error: 'Failed to ingest inbound webhook' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
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

        // Bounce Handling
        if (payload.status === 'bounced' || payload.status === 'failed' || payload.status === 'complained' || payload.event === 'bounced' || payload.event === 'failed' || payload.event === 'complained') {
           ctx.waitUntil((async () => {
             const bounceId = `email_bounce_log:${Date.now()}`;
             await env.GREEN_STATE.put(bounceId, JSON.stringify({ ...payload, timestamp: Date.now() }), { expirationTtl: 2592000 }); // 30 days

             try {
                const rawTelemetry = await env.GREEN_STATE.get('edge_error_telemetry');
                let telemetry = rawTelemetry ? JSON.parse(rawTelemetry) : {
                    total_requests_24h: 0,
                    total_errors_24h: 0,
                    error_rate_pct: 0.0,
                    last_error_timestamp: null,
                    _tracking_start: Date.now()
                };

                const now = Date.now();
                if (now - (telemetry._tracking_start || now) > 86400000) {
                   telemetry = {
                       total_requests_24h: 0,
                       total_errors_24h: 0,
                       error_rate_pct: 0.0,
                       last_error_timestamp: telemetry.last_error_timestamp,
                       _tracking_start: now
                   };
                }

                telemetry.total_errors_24h += 1;
                telemetry.last_error_timestamp = now;

                if (telemetry.total_requests_24h > 0) {
                   telemetry.error_rate_pct = Number(((telemetry.total_errors_24h / telemetry.total_requests_24h) * 100).toFixed(2));
                }

                await env.GREEN_STATE.put('edge_error_telemetry', JSON.stringify(telemetry));
             } catch(e) {
                console.error("Failed to update edge_error_telemetry on bounce", e);
             }
           })());
        }

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

            const signalListExec = await env.GREEN_STATE.list({ prefix: 'anny_signal_log:', limit: 1000 });
            let totalSignals = 0;
            let buyCount = 0;
            let tpCount = 0;
            let slCount = 0;
            let dcaCount = 0;

            const nowTimeSignal = Date.now();
            for (const key of (signalListExec as any).keys) {
                const parts = key.name.split(':');
                const tsStr = parts[1];
                if (tsStr) {
                    const ts = parseInt(tsStr, 10);
                    if (!isNaN(ts) && nowTimeSignal - ts <= 86400000) {
                        const signalRaw = await env.GREEN_STATE.get(key.name);
                        if (signalRaw) {
                            try {
                                const s = JSON.parse(signalRaw);
                                totalSignals++;
                                const act = (s.action || '').toLowerCase();
                                if (act === 'buy' || act === 'long') buyCount++;
                                else if (act === 'tp' || act === 'take_profit' || act === 'take-profit') tpCount++;
                                else if (act === 'sl' || act === 'stop_loss' || act === 'stop-loss') slCount++;
                                else if (act === 'dca') dcaCount++;
                            } catch(e) {}
                        }
                    }
                }
            }

            const signalSummaryHtml = totalSignals > 0
              ? `<div style="border: 1px solid #6366f1; padding: 15px; border-radius: 8px; margin-bottom: 20px; background-color: #eef2ff;">
                    <h4 style="color: #4338ca; margin-top: 0;">Anny 24h Signal Executions</h4>
                    <p style="margin-bottom: 0; font-weight: bold;">${totalSignals} total triggers (${buyCount} buys, ${tpCount} take-profits, ${slCount} stop-losses, ${dcaCount} DCAs)</p>
                 </div>`
              : `<div style="border: 1px solid #6366f1; padding: 15px; border-radius: 8px; margin-bottom: 20px; background-color: #eef2ff;">
                    <h4 style="color: #4338ca; margin-top: 0;">Anny 24h Signal Executions</h4>
                    <p style="margin-bottom: 0;">0 total triggers</p>
                 </div>`;

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
                  ${signalSummaryHtml}
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
            try {
                await env.GREEN_STATE.put(`briefing_archive:${Date.now()}`, html, { expirationTtl: 604800 });
            } catch(e) { console.error('Failed to archive briefing', e); }
            return new Response(JSON.stringify({ success: true, recipient: "james.ellars@axim.us.com" }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

        } else {
            return new Response(JSON.stringify({ error: dispatchResult.error }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to send exec briefing' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }


    if (request.method === 'GET' && url.pathname === '/api/admin/briefing-archive') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        const listResult = await env.GREEN_STATE.list({ prefix: 'briefing_archive:' });
        // Sort keys by timestamp (newest first)
        const sortedKeys = listResult.keys.sort((a: any, b: any) => {
            const tsA = parseInt(a.name.split(':')[1], 10);
            const tsB = parseInt(b.name.split(':')[1], 10);
            return tsB - tsA;
        });

        const recentKeys = sortedKeys.slice(0, 5);
        const archives = [];
        for (const key of recentKeys) {
            const html = await env.GREEN_STATE.get(key.name);
            if (html) {
                archives.push({ key: key.name, html });
            }
        }

        return new Response(JSON.stringify({ success: true, archives }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to fetch briefing archives' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }


    if (request.method === 'POST' && url.pathname === '/api/admin/replay-webhook') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }
      try {
        const bodyStr = await request.text();
        const payload = JSON.parse(bodyStr) as { target_endpoint?: string, payload?: any, bypass_hmac?: boolean };
        if (!payload.target_endpoint || !payload.payload) {
             return new Response(JSON.stringify({ error: 'Missing target_endpoint or payload' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
        }

        const internalUrl = new URL(request.url);
        internalUrl.pathname = payload.target_endpoint;

        const newHeaders = new Headers(request.headers);
        if (payload.bypass_hmac) {
            newHeaders.set('X-Axim-Signature', env.AXIM_INTERNAL_KEY);
        }

        const syntheticRequest = new Request(internalUrl.toString(), {
            method: 'POST',
            headers: newHeaders,
            body: JSON.stringify(payload.payload)
        });

        // Recursively call fetch handler
        return await this.fetch(syntheticRequest, env, ctx);

      } catch(e: any) {
         return new Response(JSON.stringify({ error: 'Replay failed', details: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/force-briefing-dispatch') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }
      try {
        // Trigger via internal HTTP call due to helper functions structure
        await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_aggregates`, { method: 'POST', headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'apikey': env.SUPABASE_SERVICE_KEY }, body: JSON.stringify({ endpoint: '/api/admin/force-briefing-dispatch', count: 1 }) });
        return new Response(JSON.stringify({ success: true, dispatched_at: new Date().toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      } catch(e) {
        return new Response(JSON.stringify({ error: 'Failed to dispatch briefing' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    // Get 24-hour settlement telemetry helper
    async function getSettlementTelemetry24h(env: Env) {
      try {
        const cacheResult = await env.MARKET_CACHE.getWithMetadata('settlement_telemetry_24h');
        if (cacheResult.value) {
            const parsed = JSON.parse(cacheResult.value);
            if (Date.now() - (parsed.updated_at || 0) < 300000) {
                return { count: parsed.count || 0, volume_usd: parsed.volume_usd || 0 };
            }
        }
        // Fetch from Supabase
        const dbResponse = await fetch(`${getSupabaseReadUrl(env)}/rest/v1/blockchain_transactions?select=amount,status,created_at&status=eq.minted&created_at=gte.${new Date(Date.now() - 86400000).toISOString()}`, {
          headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'apikey': env.SUPABASE_SERVICE_KEY }
        });
        if (!dbResponse.ok) return { count: 0, volume_usd: 0 };
        const txs: any[] = await dbResponse.json();
        let volume = 0;
        txs.forEach((tx: any) => volume += (parseFloat(tx.amount) || 0));
        const telemetry = { count: txs.length, volume_usd: volume, updated_at: Date.now() };
        await env.MARKET_CACHE.put('settlement_telemetry_24h', JSON.stringify(telemetry), { expirationTtl: 300 });
        return { count: txs.length, volume_usd: volume };
      } catch(e) {
        return { count: 0, volume_usd: 0 };
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

      let etagSource = cacheResult.value;
      let hash = 0;
      for (let i = 0; i < etagSource.length; i++) {
        hash = (hash << 5) - hash + etagSource.charCodeAt(i);
        hash |= 0;
      }
      const etag = `W/"market-${Math.abs(hash)}"`;

      if (request.headers.get("If-None-Match") === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            "ETag": etag,
            "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
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
          'ETag': etag,
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



    if (request.method === 'POST' && url.pathname === '/api/admin/validate-signal') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        const payload = await request.json() as any;
        const { symbol, action, amount_usdt } = payload;
        await logAdminAction(env, 'validate-signal', { symbol, action, amount_usdt });

        const annyPortfolioRaw = (await env.GREEN_STATE.get('anny_portfolio_summary', { type: 'json' })) as any;
        const available_usdt = annyPortfolioRaw?.liquid_usdt || 0;

        const marketCacheRaw = (await env.MARKET_CACHE.get('latest_prices', { type: 'json' })) as any;
        const cfo_state = marketCacheRaw?.cfo_trend_state?.[symbol] || 'wait';

        let approved = false;
        let reason = "Signal aligned with structural strength and within drawdown limits";

        if (amount_usdt > available_usdt) {
            reason = "Trade rejected: Insufficient liquid USDT balance";
        } else if (cfo_state === 'distribute') {
            reason = "Trade rejected: Asset showing structural weakness (Distribute state)";
        } else if (cfo_state === 'accumulate' || cfo_state === 'wait') {
            approved = true;
        } else {
            reason = "Trade rejected: Unknown CFO state";
        }

        const spotPrice = marketCacheRaw?.[symbol] || 0;
        const dry_run_simulation = {
            estimated_fill_price: spotPrice ? spotPrice * 1.0005 : 0,
            estimated_slippage_pct: 0.10,
            liquidity_check: amount_usdt < 10000 ? "PASS" : "DEEP_BOOK_REQUIRED"
        };

        return new Response(JSON.stringify({
          approved: approved,
          symbol: symbol || 'UNKNOWN',
          cfo_state: cfo_state,
          reason: reason,
          available_usdt: available_usdt,
          dry_run_simulation: dry_run_simulation
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/renew-anny-session') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        await env.GREEN_STATE.delete('anny_session_token');
        await logAdminAction(env, 'renew-anny-session', {});
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

      const { prompt, session_id, model_preference } = await request.json() as any;

      if (model_preference) {
          await env.GREEN_STATE.put('ai_model_preference', model_preference);
      }

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

        let systemMessage = `You are the AXiM Green Machine Strategy Consultant. Current Market Context: [${marketContextString}]. Ecosystem Risk Rules: Max Drawdown Limit = 15%, Max Single Asset Exposure = 35%. Validate user strategy prompts against these rules. If exceeded, set 'riskViolation': true and include 'riskWarning' in your JSON response. Respond in strict JSON with fields: "analysis" (string), "riskLevel" (string: 'Low'|'Medium'|'High'|'Critical'), "actionItems" (array of strings), "riskViolation" (boolean, optional), and "riskWarning" (string, optional).`;


        const signalList = await env.GREEN_STATE.list({ prefix: 'anny_signal_log:', limit: 5 });
        if (signalList.keys && signalList.keys.length > 0) {
            let signals = [];
            for (const key of signalList.keys) {
                const signalRaw = await env.GREEN_STATE.get(key.name);
                if (signalRaw) {
                    try {
                        const s = JSON.parse(signalRaw);
                        signals.push(`${s.symbol} ${s.action} @ $${s.price} (Bot #${s.bot_id})`);
                    } catch(e) {}
                }
            }
            if (signals.length > 0) {
                systemMessage += ` Recent Anny Signals: [${signals.join(', ')}].`;
            }
        }

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
          let targetModel = '@cf/meta/llama-3.1-8b-instruct';
          let modelPref = model_preference;
          if (!modelPref) {
              modelPref = await env.GREEN_STATE.get('ai_model_preference');
          }
          if (modelPref === 'mistral-7b') {
              targetModel = '@cf/mistral/mistral-7b-instruct-v0.2';
          }

          response = await env.AI.run(targetModel, {
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

        await env.GREEN_STATE.put(`ai_consult_log:${Date.now()}`, JSON.stringify({
            riskViolation: parsed.riskViolation || false,
            riskLevel: parsed.riskLevel || 'Unknown',
            timestamp: Date.now(),
            ai_inference_ms: duration,
            model_used: aiModel
        }), { expirationTtl: 86400 });

        return new Response(JSON.stringify({ success: true, data: parsed, ai_model: aiModel, ai_inference_ms: duration }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'Server-Timing': serverTiming, ...corsHeaders } });
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
        await logAdminAction(env, 'circuit-breaker-reset', { resetState });
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



    if (request.method === 'GET' && url.pathname === '/api/admin/audit-logs') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      const actionType = url.searchParams.get('action_type');

      try {
        const listResult = await env.GREEN_STATE.list({ prefix: 'admin_action_log:', limit: 50 });
        let logs = [];
        for (const key of listResult.keys) {
          try {
            const logData = await env.GREEN_STATE.get(key.name, { type: 'json' });
            if (logData) {
              if (actionType && actionType !== 'All Actions') {
                if (logData.action === actionType) {
                  logs.push(logData);
                }
              } else {
                logs.push(logData);
              }
            }
          } catch(e) {}
        }

        // Sort descending by timestamp
        logs.sort((a, b) => b.timestamp - a.timestamp);

        return new Response(JSON.stringify({ logs }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to fetch audit logs' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }


    if (request.method === 'POST' && url.pathname === '/api/admin/force-oracle-ping') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }
      try {
        await syncMarketCache(env);
        return new Response(JSON.stringify({ success: true, message: 'Oracle Cache Synced' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to sync oracle' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/trigger-financial-audit') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        const { trigger_source, timestamp } = await request.json() as any;
        await logAdminAction(env, 'trigger-financial-audit', { trigger_source });
        const dbResponse = await fetch(`${env.SUPABASE_URL}/functions/v1/financial-audit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`
          },
          body: JSON.stringify({ trigger_source, timestamp })
        });

        if (!dbResponse.ok) {
           throw new Error(`Financial Audit failed: ${dbResponse.statusText}`);
        }

        const auditData = await dbResponse.json() as any;
        let ai_insight = "";
        try {
          const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
              { role: "system", content: "You are a financial analyst AI." },
              { role: "user", content: `Summarize the following financial audit metadata into a concise 2-sentence executive summary for the CFO. Data: ${JSON.stringify(auditData)}` }
            ]
          });
          if (aiResponse && aiResponse.response) {
            ai_insight = aiResponse.response;
          } else {
             ai_insight = "AI insight generation failed.";
          }
        } catch(e) {
          console.error("Workers AI failed", e);
          ai_insight = "AI summary temporarily unavailable due to upstream constraint.";
        }

        return new Response(JSON.stringify({
           success: true,
           message: 'Financial audit invoked via Edge Worker proxy',
           timestamp: Date.now(),
           ai_insight
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), {
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
      return new Response(JSON.stringify(sanitizeTelemetry({
        status: "healthy",
        edge_version: "v2.4.0-stable",
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
        anny_auth_telemetry: await env.GREEN_STATE.get('anny_auth_telemetry', { type: 'json' }),
        webhook_ingress_telemetry: await env.GREEN_STATE.get('webhook_ingress_telemetry', { type: 'json' }),
        settlement_telemetry_24h: await getSettlementTelemetry24h(env),
        kv_prune_telemetry: await env.GREEN_STATE.get('kv_prune_telemetry', { type: 'json' }),
        dlq_autoheal_telemetry: await env.GREEN_STATE.get('dlq_autoheal_telemetry', { type: 'json' }),
        investing_brain_telemetry: await (async () => {
             const dlqList = await env.GREEN_STATE.list({ limit: 1000 });
             const consultList = dlqList.keys.filter((k: any) => k.name.startsWith('ai_consult_log:'));
             let total_consultations_24h = consultList.length;
             let risk_gates_passed = 0;
             let risk_warnings = 0;
             for (const key of consultList) {
                  try {
                      const logData = JSON.parse(await env.GREEN_STATE.get(key.name) || '{}');
                      if (logData.riskViolation) {
                          risk_warnings++;
                      } else {
                          risk_gates_passed++;
                      }
                  } catch(e) {}
             }

             let total_inference_ms = 0;
             let count_ms = 0;
             let llama_count = 0;
             let mistral_count = 0;
             for (const key of consultList) {
                  try {
                      const logData = JSON.parse(await env.GREEN_STATE.get(key.name) || '{}');
                      if (logData.ai_inference_ms) {
                          total_inference_ms += logData.ai_inference_ms;
                          count_ms++;
                      }
                      if (logData.model_used === 'mistral-7b') {
                          mistral_count++;
                      } else {
                          llama_count++;
                      }
                  } catch(e) {}
             }
             let ai_inference_ms = count_ms > 0 ? Math.round(total_inference_ms / count_ms) : 0;
             let total_models = llama_count + mistral_count;
             let model_usage = {
                llama_3_1_pct: total_models > 0 ? (llama_count / total_models) * 100 : 0,
                mistral_7b_pct: total_models > 0 ? (mistral_count / total_models) * 100 : 0
             };
             return { total_consultations_24h, risk_gates_passed, risk_warnings, ai_inference_ms, model_usage };
        })()
      })), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=15, stale-while-revalidate=45',
          ...corsHeaders
        }
      });
    }

    if (request.method === 'DELETE' && url.pathname === '/api/admin/audit-logs') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        let listResult = await env.GREEN_STATE.list({ prefix: 'admin_action_log:' });
        let deletedCount = 0;

        while (true) {
          if (listResult.keys.length > 0) {
            const deletePromises = listResult.keys.map((key: any) => env.GREEN_STATE.delete(key.name));
            await Promise.all(deletePromises);
            deletedCount += listResult.keys.length;
          }
          if (listResult.list_complete) break;
          listResult = await env.GREEN_STATE.list({ prefix: 'admin_action_log:', cursor: listResult.cursor });
        }

        return new Response(JSON.stringify({ success: true, message: 'Audit logs purged', count: deletedCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to purge audit logs' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
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

    if (request.method === 'GET' && url.pathname === '/api/admin/quarantine') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        let items: any[] = [];

        let listQ = await env.GREEN_STATE.list({ prefix: 'quarantine:' });
        for (const key of listQ.keys) {
           try {
               const val = await env.GREEN_STATE.get(key.name);
               items.push({ key_name: key.name, payload: val ? JSON.parse(val) : null });
           } catch (e) {
               items.push({ key_name: key.name, error: 'unparseable' });
           }
        }

        let listQR = await env.GREEN_STATE.list({ prefix: 'quarantine_retry:' });
        for (const key of listQR.keys) {
           try {
               const val = await env.GREEN_STATE.get(key.name);
               items.push({ key_name: key.name, payload: val ? JSON.parse(val) : null });
           } catch (e) {
               items.push({ key_name: key.name, error: 'unparseable' });
           }
        }

        return new Response(JSON.stringify({ success: true, items }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to fetch quarantine' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }


    if (request.method === 'DELETE' && url.pathname === '/api/admin/quarantine/all') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }

      try {
        let purgedCount = 0;

        // Delete quarantine: keys
        let listResult = await env.GREEN_STATE.list({ prefix: 'quarantine:' });
        while (true) {
          if (listResult.keys.length > 0) {
            const deletePromises = listResult.keys.map((key: any) => env.GREEN_STATE.delete(key.name));
            await Promise.all(deletePromises);
            purgedCount += listResult.keys.length;
          }
          if (listResult.list_complete) break;
          listResult = await env.GREEN_STATE.list({ prefix: 'quarantine:', cursor: listResult.cursor });
        }

        // Delete quarantine_retry: keys
        listResult = await env.GREEN_STATE.list({ prefix: 'quarantine_retry:' });
        while (true) {
          if (listResult.keys.length > 0) {
            const deletePromises = listResult.keys.map((key: any) => env.GREEN_STATE.delete(key.name));
            await Promise.all(deletePromises);
            purgedCount += listResult.keys.length;
          }
          if (listResult.list_complete) break;
          listResult = await env.GREEN_STATE.list({ prefix: 'quarantine_retry:', cursor: listResult.cursor });
        }

        return new Response(JSON.stringify({ success: true, message: 'GLOBAL QUARANTINE PURGE COMPLETE', purged_count: purgedCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to execute global quarantine purge' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

if (request.method === 'DELETE' && url.pathname === '/api/admin/quarantine') {
      const signature = request.headers.get('X-Axim-Signature');
      if (!signature || signature !== env.AXIM_INTERNAL_KEY) {
        return new Response('Unauthorized Edge Ingress', { status: 401, headers: corsHeaders });
      }
      try {
        const payload = (await request.json()) as { key_name?: string };
        if (payload.key_name) {
           await env.GREEN_STATE.delete(payload.key_name);
        }
        return new Response(JSON.stringify({ success: true, message: 'Item purged' }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to purge item' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }


    // Explicit Fallback Route Evaluation
    if (
        url.pathname !== '/' &&
        url.pathname !== '/api/dlq-status' &&
        url.pathname !== '/api/cache-sync' &&
        url.pathname !== '/api/admin/dept-summary' &&
        url.pathname !== '/api/admin/send-exec-briefing' && url.pathname !== '/api/admin/briefing-archive' && url.pathname !== '/api/admin/replay-webhook' &&
        url.pathname !== '/api/webhooks/emailit-inbound' && url.pathname !== '/api/webhooks/anny-signal' && url.pathname !== '/api/anny-signals' &&
        url.pathname !== '/api/dlq-flush' &&
        url.pathname !== '/api/market-cache' &&
        url.pathname !== '/api/strategy-consult' &&
        url.pathname !== '/api/quarantine-purge' && url.pathname !== '/api/admin/quarantine' && url.pathname !== '/api/admin/quarantine/all' &&
        url.pathname !== '/api/health' &&
        url.pathname !== '/api/admin/renew-anny-session' && url.pathname !== '/api/admin/validate-signal' && url.pathname !== '/api/admin/quarantine-retry-purge' && url.pathname !== '/api/admin/verify-deployment' && url.pathname !== '/api/admin/trigger-financial-audit' && url.pathname !== '/api/admin/force-oracle-ping' && url.pathname !== '/api/admin/audit-logs'
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

        })(); // Close inner async IIFE

        // Check response status for telemetry
        if (response && response.status >= 500) isError = true;
        if (response && response.status === 429) isRateLimit = true;

        return response;
    } catch (e: any) {
        isError = true;
        throw e;
    } finally {
        ctx.waitUntil(trackEdgeRequest(env, isError, isRateLimit));
    }

  }
};
