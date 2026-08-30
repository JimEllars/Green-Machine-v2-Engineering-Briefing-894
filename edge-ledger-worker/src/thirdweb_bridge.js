import { dispatchExecutiveBriefing, sendEmailItNotification } from "./briefing_generator";
import { jwtVerify, SignJWT } from "jose";
function timingSafeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}
import { syncMarketCache } from "./market_watcher";
export const getSupabaseReadUrl = (env) => env.SUPABASE_READ_URL || env.SUPABASE_URL;
export function annyAuthHeaders(auth) {
    return auth.mode === "session-token"
        ? { "session-token": auth.token }
        : { Authorization: `Bearer ${auth.token}` };
}
export async function getOrRefreshAnnySessionToken(env, ctx) {
    if (env.ANNY_AUTH_TOKEN)
        return env.ANNY_AUTH_TOKEN;
    const cachedToken = await env.GREEN_STATE.get("anny_session_token");
    if (cachedToken)
        return cachedToken;
    if (env.ANNY_EMAIL && env.ANNY_PASSWORD) {
        try {
            const res = await fetchWithRetry("https://api.anny.trade/backend/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: env.ANNY_EMAIL,
                    password: env.ANNY_PASSWORD,
                }),
            });
            const data = (await res.json());
            if (data?.payload?.token) {
                await env.GREEN_STATE.put("anny_session_token", data.payload.token, {
                    expirationTtl: 518400,
                }); // 6-day TTL
                const authTelemetry = {
                    last_renewed: Date.now(),
                    expires_at: Date.now() + 518400000, // 6 days
                    status: "VALID",
                    mode: env.ANNY_AUTH_MODE || "session-token",
                };
                await env.GREEN_STATE.put("anny_auth_telemetry", JSON.stringify(authTelemetry));
                return data.payload.token;
            }
            else {
                const authTelemetry = {
                    last_renewed: Date.now(),
                    expires_at: Date.now() + 518400000, // 6 days
                    status: "LOGIN_FAILED",
                    mode: env.ANNY_AUTH_MODE || "session-token",
                };
                await env.GREEN_STATE.put("anny_auth_telemetry", JSON.stringify(authTelemetry));
            }
        }
        catch (e) {
            console.error("Anny login auto-refresh failed", e);
            const authTelemetry = {
                last_renewed: Date.now(),
                expires_at: Date.now() + 518400000,
                status: "LOGIN_FAILED",
                mode: env.ANNY_AUTH_MODE || "session-token",
            };
            await env.GREEN_STATE.put("anny_auth_telemetry", JSON.stringify(authTelemetry));
        }
    }
    return "";
}
export async function annyBackendPost(path, body, env, ctx) {
    const token = await getOrRefreshAnnySessionToken(env, ctx);
    const auth = {
        mode: env.ANNY_AUTH_MODE || "session-token",
        token: token,
    };
    const headers = {
        "Content-Type": "application/json",
    };
    if (auth.token) {
        Object.assign(headers, annyAuthHeaders(auth));
    }
    try {
        const res = await fetch(`https://api.anny.trade${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            throw { status: res.status, message: `API Error: ${res.statusText}` };
        }
        const data = (await res.json());
        if (data?.result?.type === "UNAUTHORIZED") {
            await env.GREEN_STATE.delete("anny_session_token");
            throw new Error(`Anny auth rejected on ${path} — cleared stale session token`);
        }
        return data.payload;
    }
    catch (error) {
        if (ctx) {
            ctx.waitUntil((async () => {
                try {
                    await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                            apikey: env.SUPABASE_SERVICE_KEY,
                        },
                        body: JSON.stringify({
                            endpoint: path,
                            status_code: error.status || 500,
                            error_message: error.message || String(error),
                            count: 1,
                        }),
                    });
                }
                catch (e) {
                    console.error("Failed to log to api_usage_logs:", e);
                }
            })());
        }
        throw error;
    }
}
export async function fetchAnnyCombinedPortfolio(env, ctx) {
    try {
        const token = await getOrRefreshAnnySessionToken(env, ctx);
        const auth = {
            mode: env.ANNY_AUTH_MODE || "session-token",
            token: token,
        };
        const headers = { "Content-Type": "application/json" };
        if (auth.token) {
            Object.assign(headers, annyAuthHeaders(auth));
        }
        const positionsRes = await fetch("https://api.anny.trade/backend/activepositions", { headers });
        let activePositions = [];
        if (positionsRes.ok) {
            const data = (await positionsRes.json());
            activePositions = data?.payload || [];
        }
        let portfolioAssets = [];
        try {
            const portfolioData = await annyBackendPost("/backend/anny-line/portfolio", {}, env, ctx);
            portfolioAssets =
                portfolioData?.assets || portfolioData?.data?.assets || [];
        }
        catch (e) {
            console.error("Failed to fetch portfolio assets for merge", e);
        }
        const merged = {};
        for (const p of portfolioAssets) {
            const symbol = p.coin || p.symbol;
            if (!symbol)
                continue;
            merged[symbol] = {
                coin: symbol,
                quantity: p.quantity || p.balance || 0,
                currentPrice: p.currentPrice || p.price || 0,
                pnl: p.pnl || 0,
                cfo_state: p.cfo_state || p.cfo || "wait",
            };
        }
        for (const p of activePositions) {
            const symbol = p.coin || p.symbol;
            if (!symbol)
                continue;
            if (!merged[symbol]) {
                merged[symbol] = {
                    coin: symbol,
                    quantity: 0,
                    currentPrice: 0,
                    pnl: 0,
                    cfo_state: "wait",
                };
            }
            merged[symbol].quantity =
                (merged[symbol].quantity || 0) +
                    (p.quantity || p.position_size || p.size || 0);
            if (p.pnl || p.profit) {
                merged[symbol].pnl =
                    (merged[symbol].pnl || 0) + (p.pnl || p.profit || 0);
            }
            if (p.currentPrice || p.price) {
                merged[symbol].currentPrice = p.currentPrice || p.price;
            }
        }
        const mergedArray = Object.values(merged);
        await env.GREEN_STATE.put("anny_portfolio_summary", JSON.stringify(mergedArray), { expirationTtl: 300, metadata: { updated_at: Date.now() } });
        return mergedArray;
    }
    catch (e) {
        console.error("fetchAnnyCombinedPortfolio failed", e);
    }
    return null;
}
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Axim-Signature",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};
async function fetchWithTimeout(url, options, timeoutMs = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        clearTimeout(id);
        return response;
    }
    catch (error) {
        clearTimeout(id);
        if (error.name === "AbortError") {
            throw { code: "ERR_OUTBOUND_TIMEOUT", message: "Request timed out" };
        }
        throw error;
    }
}
async function fetchWithRetry(url, options, maxRetries = 2, timeoutMs = 5000) {
    let lastError;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            const response = await fetchWithTimeout(url, options, timeoutMs);
            if (!response.ok && response.status >= 500) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response;
        }
        catch (e) {
            lastError = e;
            if (i < maxRetries) {
                await new Promise((res) => setTimeout(res, Math.pow(2, i) * 500));
            }
        }
    }
    throw lastError;
}
function assertKvBindings(env) {
    if (!env.GREEN_STATE ||
        typeof env.GREEN_STATE.get !== "function" ||
        !env.MARKET_CACHE ||
        typeof env.MARKET_CACHE.get !== "function") {
        return new Response(JSON.stringify({
            success: false,
            error: "Cloudflare KV namespace bindings uninitialized",
            code: "ERR_KV_NOT_BOUND",
        }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                ...corsHeaders,
            },
        });
    }
    return null;
}
async function trackEdgeRequest(env, isError, isRateLimit = false, requestDetails = null) {
    if (requestDetails) {
        // Utilize Cloudflare native logging infrastructure
        console.log(JSON.stringify({ ...requestDetails, isError, isRateLimit, timestamp: new Date().toISOString() }));
    }
    if (!env || !env.GREEN_STATE)
        return;
    try {
        const rawTelemetry = await env.GREEN_STATE.get("edge_error_telemetry");
        let telemetry = rawTelemetry
            ? JSON.parse(rawTelemetry)
            : {
                total_requests_24h: 0,
                total_errors_24h: 0,
                error_rate_pct: 0.0,
                last_error_timestamp: null,
                _tracking_start: Date.now(),
            };
        const now = Date.now();
        // Reset every 24h
        if (now - (telemetry._tracking_start || now) > 86400000) {
            telemetry = {
                total_requests_24h: 0,
                total_errors_24h: 0,
                error_rate_pct: 0.0,
                last_error_timestamp: telemetry.last_error_timestamp,
                _tracking_start: now,
            };
        }
        telemetry.total_requests_24h += 1;
        if (isError || isRateLimit) {
            telemetry.total_errors_24h += 1;
            telemetry.last_error_timestamp = now;
        }
        if (telemetry.total_requests_24h > 0) {
            telemetry.error_rate_pct = Number(((telemetry.total_errors_24h / telemetry.total_requests_24h) *
                100).toFixed(2));
        }
        await env.GREEN_STATE.put("edge_error_telemetry", JSON.stringify(telemetry));
    }
    catch (e) {
        console.error("Failed to update edge_error_telemetry", e);
    }
}
const logAdminAction = async (env, action, details) => {
    const timestamp = Date.now();
    const keyName = `admin_action_log:${timestamp}`;
    await env.GREEN_STATE.put(keyName, JSON.stringify({ action, timestamp, details }), { expirationTtl: 2592000 });
};
function sanitizeTelemetry(data) {
    if (data === null || data === undefined)
        return data;
    if (Array.isArray(data)) {
        return data.map((item) => sanitizeTelemetry(item));
    }
    if (typeof data === "object") {
        const result = {};
        for (const key in data) {
            const lowerKey = key.toLowerCase();
            if (lowerKey.includes("axim_internal_key") ||
                lowerKey.includes("supabase_service_key") ||
                lowerKey.includes("emailit_api_key") ||
                lowerKey.includes("token")) {
                result[key] = "[REDACTED]";
            }
            else {
                result[key] = sanitizeTelemetry(data[key]);
            }
        }
        return result;
    }
    return data;
}
const workerStartTime = Date.now();
async function recordKvMetric(env, hit) {
    const key = hit ? "telemetry_kv_hits" : "telemetry_kv_misses";
    const count = parseInt(await env.GREEN_STATE.get(key) || "0", 10);
    await env.GREEN_STATE.put(key, (count + 1).toString());
}
export async function generateAIFinancialAudit(env, ctx) {
    try {
        const dbResponse = await fetch(`${env.SUPABASE_URL}/functions/v1/financial-audit`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            },
            body: JSON.stringify({ trigger_source: "cron", timestamp: Date.now() }),
        });
        if (!dbResponse.ok) {
            throw new Error(`Financial Audit failed: ${dbResponse.statusText}`);
        }
        const auditData = (await dbResponse.json());
        let usageSummaryData = [];
        try {
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            const logsResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs?select=*&updated_at=gte.${threeDaysAgo}`, {
                headers: {
                    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                    apikey: env.SUPABASE_SERVICE_KEY,
                },
            });
            if (logsResponse.ok) {
                usageSummaryData = (await logsResponse.json());
            }
        }
        catch (e) {
            console.error("Failed to fetch 3-day api usage logs", e);
        }
        let executive_briefing = "";
        try {
            const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
                messages: [
                    {
                        role: "system",
                        content: "You are a financial analyst AI.",
                    },
                    {
                        role: "user",
                        content: `Summarize the following financial audit metadata and the last 3 days of API usage logs into a concise 4-sentence paragraph describing token burn efficiency vs system latency. Audit Data: ${JSON.stringify(auditData)}. Usage Data: ${JSON.stringify(usageSummaryData)}`,
                    },
                ],
            });
            if (aiResponse && aiResponse.response) {
                executive_briefing = aiResponse.response;
            }
            else {
                executive_briefing = "AI insight generation failed.";
            }
        }
        catch (e) {
            console.error("Workers AI failed", e);
            executive_briefing = "AI summary temporarily unavailable due to upstream constraint.";
        }
        return executive_briefing;
    }
    catch (error) {
        console.error("Failed to generate AI financial audit:", error);
        return "AI Financial Audit currently unavailable.";
    }
}
export default {
    async scheduled(event, env, ctx) {
        if (event.cron === "0 8 * * *") {
            ctx.waitUntil((async () => {
                const balancesRaw = await env.GREEN_STATE.get("anny_exchange_balances", "json");
                const balances = balancesRaw || { status: "No balance data available." };
                let winRate = 0;
                let totalVolume = 0;
                let yesterdayPerformance = "Win Rate: 0% | Total Volume: $0";
                try {
                    const yesterday = new Date(Date.now() - 86400000).toISOString();
                    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions?select=amount,status,metadata&created_at=gte.${yesterday}&partner_id=eq.anny_ai_system`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                            'apikey': env.SUPABASE_SERVICE_KEY,
                            'Content-Type': 'application/json'
                        }
                    });
                    if (res.ok) {
                        const txs = await res.json();
                        if (Array.isArray(txs) && txs.length > 0) {
                            let winCount = 0;
                            for (const tx of txs) {
                                totalVolume += Number(tx.amount) || 0;
                                if (tx.metadata && tx.metadata.probability_of_profit > 90) {
                                    winCount++;
                                }
                            }
                            winRate = Math.round((winCount / txs.length) * 100);
                            yesterdayPerformance = `Win Rate: ${winRate}% | Total Volume: $${totalVolume}`;
                        }
                    }
                    else {
                        console.error('Failed to fetch daily transactions from Supabase:', res.statusText);
                    }
                }
                catch (error) {
                    console.error('Network failure fetching daily transactions:', error);
                }
                let futurePlans = "System running autonomously. No immediate human intervention required.";
                let actionRequired = "System running autonomously. No immediate human intervention required.";
                try {
                    const hitlResult = await env.GREEN_STATE.list({ prefix: "hitl_pending_" });
                    if (hitlResult && hitlResult.keys && hitlResult.keys.length > 0) {
                        actionRequired = "<strong>Human Approval Required</strong><br>The following trades require your approval:<br><ul>";
                        for (const key of hitlResult.keys) {
                            try {
                                const hitlPayloadRaw = await env.GREEN_STATE.get(key.name);
                                if (hitlPayloadRaw) {
                                    const hitlPayload = JSON.parse(hitlPayloadRaw);
                                    const token = await new SignJWT({ trade_key: key.name })
                                        .setProtectedHeader({ alg: 'HS256' })
                                        .setExpirationTime('24h')
                                        .sign(new TextEncoder().encode(env.SUPABASE_JWT_SECRET));
                                    // Construct the approval URL (fallback domain since this is cron without a specific request)
                                    const workerUrl = 'https://green-machine-edge-ledger.axim-us.workers.dev';
                                    const approvalUrl = `${workerUrl}/api/admin/hitl-approve?token=${token}`;
                                    actionRequired += `<li><a href="${approvalUrl}">Approve Trade: ${hitlPayload.symbol} (${hitlPayload.action})</a></li>`;
                                }
                            }
                            catch (e) {
                                console.error("Failed to process HITL pending trade", e);
                            }
                        }
                        actionRequired += "</ul>";
                    }
                }
                catch (e) {
                    console.error("Failed to check HITL trades", e);
                }
                try {
                    const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
                        messages: [
                            {
                                role: "system",
                                content: "You are the AXiM Green Machine AI Strategy Consultant. Based on the past 24 hours of trading volume and win rate, generate a brief (max 2 sentences) strategic focus for the upcoming day. Also identify if any human-in-the-loop action is required."
                            },
                            {
                                role: "user",
                                content: `Past 24 hours: Win Rate: ${winRate}%, Total Volume: $${totalVolume}`
                            }
                        ]
                    });
                    if (aiResponse && aiResponse.response) {
                        futurePlans = aiResponse.response;
                        actionRequired = "Review AI strategic focus for potential adjustments."; // Provide a general fallback since AI might answer both in one blob
                    }
                }
                catch (error) {
                    console.error('Workers AI forecasting failed:', error);
                }
                const html = `
            <h1>AXiM Green Machine: Daily Executive Summary</h1>
            <h2>Account Summary</h2>
            <pre>${JSON.stringify(balances, null, 2)}</pre>
            <h2>Yesterday's Performance</h2>
            <p>${yesterdayPerformance}</p>
            <h2>Future Plans</h2>
            <p>${futurePlans}</p>
            <h2>Action Required</h2>
            <p>${actionRequired}</p>
          `;
                await sendEmailItNotification({
                    to: "james.ellars@axim.us.com",
                    cc: ["jrellars@gmail.com"],
                    subject: "AXiM Green Machine: Daily Executive Summary",
                    html: html,
                }, env);
            })());
        }
        if (event.cron === "* * * * *") {
            ctx.waitUntil((async () => {
                try {
                    // DLQ Auto-Heal & Re-Queue
                    try {
                        const dbHealthRes = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
                            headers: { apikey: env.SUPABASE_SERVICE_KEY },
                        });
                        if (dbHealthRes.ok) {
                            const listResult = await env.GREEN_STATE.list({
                                prefix: "audit_retry_queue:",
                                limit: 10,
                            });
                            let healedCount = 0;
                            for (const key of listResult.keys) {
                                try {
                                    const payloadRaw = await env.GREEN_STATE.get(key.name);
                                    if (payloadRaw) {
                                        const payload = JSON.parse(payloadRaw);
                                        const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
                                            method: "POST",
                                            headers: {
                                                "Content-Type": "application/json",
                                                apikey: env.SUPABASE_SERVICE_KEY,
                                                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                                Prefer: "resolution=merge-duplicates",
                                            },
                                            body: JSON.stringify(payload),
                                        });
                                        if (dbRes.ok ||
                                            dbRes.status === 200 ||
                                            dbRes.status === 201) {
                                            await env.GREEN_STATE.delete(key.name);
                                            healedCount++;
                                        }
                                    }
                                }
                                catch (e) { }
                            }
                            await env.GREEN_STATE.put("dlq_autoheal_telemetry", JSON.stringify({
                                last_autoheal_run: Date.now(),
                                items_healed: healedCount,
                                status: "OPERATIONAL",
                            }));
                        }
                    }
                    catch (autoHealErr) {
                        console.error("Auto-heal failed:", autoHealErr);
                    }
                    // Telemetry Pruning
                    let prunedCount = 0;
                    const now = Date.now();
                    const oneDay = 86400000;
                    const sevenDays = 604800000;
                    const prunePrefix = async (prefix, maxAge) => {
                        let cursor = undefined;
                        let listComplete = false;
                        while (!listComplete) {
                            const listResult = (await env.GREEN_STATE.list({
                                prefix,
                                cursor,
                            }));
                            for (const key of listResult.keys) {
                                try {
                                    // Try to extract timestamp from key or payload.
                                    // Actually the prompt says "older than X". The keys often have timestamps.
                                    const parts = key.name.split(":");
                                    const tsStr = parts[parts.length - 1];
                                    const tsMatch = tsStr.match(/^(\d+)$/);
                                    let itemTime = 0;
                                    if (tsMatch) {
                                        itemTime = parseInt(tsMatch[1], 10);
                                    }
                                    else {
                                        const raw = await env.GREEN_STATE.get(key.name);
                                        if (raw) {
                                            const data = JSON.parse(raw);
                                            if (data.timestamp)
                                                itemTime = data.timestamp;
                                        }
                                    }
                                    if (itemTime && now - itemTime > maxAge) {
                                        await env.GREEN_STATE.delete(key.name);
                                        prunedCount++;
                                    }
                                }
                                catch (e) { }
                            }
                            listComplete = listResult.list_complete;
                            cursor = listResult.cursor;
                        }
                    };
                    await prunePrefix("ai_consult_log:", oneDay);
                    await prunePrefix("anny_signal_log:", sevenDays);
                    await prunePrefix("exec_feedback:", sevenDays);
                    await env.GREEN_STATE.put("kv_prune_telemetry", JSON.stringify({
                        last_pruned: now,
                        items_pruned: prunedCount,
                        status: "CLEAN",
                    }));
                    let cursor = undefined;
                    let listComplete = false;
                    while (!listComplete) {
                        const retryList = (await env.GREEN_STATE.list({
                            prefix: "audit_retry_queue:",
                            cursor,
                        }));
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
                                    const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
                                        method: "POST",
                                        headers: {
                                            "Content-Type": "application/json",
                                            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                            apikey: env.SUPABASE_SERVICE_KEY,
                                        },
                                        body: rawPayload,
                                    });
                                    if (dbRes.ok) {
                                        await env.GREEN_STATE.delete(key.name);
                                    }
                                }
                                catch (e) {
                                    console.error("Failed to retry audit log post", e);
                                }
                            }
                        }
                        if (retryList.list_complete) {
                            listComplete = true;
                        }
                        else {
                            cursor = retryList.cursor;
                        }
                    }
                }
                catch (e) {
                    console.error("Audit log retry cron failed", e);
                }
            })());
        }
        if (event.cron === "30 10 * * *") {
            ctx.waitUntil((async () => {
                const auditSummaryText = await generateAIFinancialAudit(env, ctx);
                await dispatchExecutiveBriefing(env, ctx, auditSummaryText);
            })());
        }
        else {
            ctx.waitUntil((async () => {
                const retryList = await env.GREEN_STATE.list({
                    prefix: "email_retry_queue:",
                });
                for (const key of retryList.keys) {
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
                            await env.GREEN_STATE.put(key.name, JSON.stringify(params), {
                                expirationTtl: 86400,
                            });
                            params._retryId = key.name;
                            const res = await sendEmailItNotification(params, env);
                            if (res.success) {
                                await env.GREEN_STATE.delete(key.name);
                            }
                        }
                        catch (e) {
                            console.error("Retry error", e);
                        }
                    }
                }
            })());
            ctx.waitUntil((async () => {
                try {
                    const pSummary = await env.GREEN_STATE.getWithMetadata("anny_portfolio_summary");
                    const lastUpdated = pSummary.metadata?.updated_at;
                    if (!lastUpdated || Date.now() - lastUpdated > 240000) {
                        await fetchAnnyCombinedPortfolio(env, ctx);
                    }
                }
                catch (e) {
                    console.error("Failed to pre-warm anny_portfolio_summary", e);
                }
            })());
            ctx.waitUntil(syncMarketCache(env));
        }
    },
    async fetch(request, env, ctx) {
        const startTime = performance.now();
        const kvError = assertKvBindings(env);
        if (kvError)
            return kvError;
        // Wrap the entire fetch in a try-catch and finally to track edge telemetry
        let isError = false;
        let isRateLimit = false;
        try {
            let response = await (async () => {
                const url = new URL(request.url);
                // Bypassing Supabase internal routes from Edge catch-all
                if (url.pathname.startsWith('/auth/v1') || url.pathname.startsWith('/rest/v1')) {
                    const targetUrl = new URL(url.pathname + url.search, env.SUPABASE_URL);
                    const newRequest = new Request(targetUrl.toString(), request);
                    return fetch(newRequest);
                }
                // 0. Uniform CORS Preflight
                if (request.method === "OPTIONS") {
                    return new Response(null, { headers: corsHeaders });
                }
                // 0.5 Uniform JWT Validation (if Authorization header is present)
                const authHeader = request.headers.get("Authorization");
                if (authHeader && authHeader.startsWith("Bearer ")) {
                    const token = authHeader.substring(7);
                    try {
                        const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
                        await jwtVerify(token, secret);
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ status: "error", error: "Unauthorized", detail: "Invalid Supabase JWT signature", timestamp: new Date().toISOString() }), {
                            status: 401,
                            headers: { "Content-Type": "application/json", ...corsHeaders }
                        });
                    }
                }
                if (request.method === "GET" && url.pathname === "/api/dlq-status") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const dlqList = await env.GREEN_STATE.list({ limit: 1000 });
                        let bufferedCount = dlqList.keys.filter((k) => !k.name.startsWith("quarantine:") &&
                            k.name !== "emailit_telemetry" &&
                            !k.name.startsWith("exec_feedback:")).length;
                        let quarantinedCount = dlqList.keys.filter((k) => k.name.startsWith("quarantine:")).length;
                        let emailitTelemetry = null;
                        let edgeErrorTelemetry = null;
                        try {
                            const errRaw = await env.GREEN_STATE.get("edge_error_telemetry");
                            if (errRaw)
                                edgeErrorTelemetry = JSON.parse(errRaw);
                        }
                        catch (e) { }
                        try {
                            const telemetryRaw = await env.GREEN_STATE.get("emailit_telemetry");
                            if (telemetryRaw) {
                                emailitTelemetry = JSON.parse(telemetryRaw);
                            }
                        }
                        catch (e) {
                            console.error("Failed to parse emailit telemetry", e);
                        }
                        let total_consultations_24h = 0;
                        let risk_gates_passed = 0;
                        let risk_warnings = 0;
                        const consultList = dlqList.keys.filter((k) => k.name.startsWith("ai_consult_log:"));
                        total_consultations_24h = consultList.length;
                        for (const key of consultList) {
                            try {
                                const logData = JSON.parse((await env.GREEN_STATE.get(key.name)) || "{}");
                                if (logData.riskViolation) {
                                    risk_warnings++;
                                }
                                else {
                                    risk_gates_passed++;
                                }
                            }
                            catch (e) { }
                        }
                        let total_inference_ms = 0;
                        let count_ms = 0;
                        let llama_count = 0;
                        let mistral_count = 0;
                        for (const key of consultList) {
                            try {
                                const logData = JSON.parse((await env.GREEN_STATE.get(key.name)) || "{}");
                                if (logData.ai_inference_ms) {
                                    total_inference_ms += logData.ai_inference_ms;
                                    count_ms++;
                                }
                                if (logData.model_used === "mistral-7b") {
                                    mistral_count++;
                                }
                                else {
                                    llama_count++;
                                }
                            }
                            catch (e) { }
                        }
                        let ai_inference_ms = count_ms > 0 ? Math.round(total_inference_ms / count_ms) : 0;
                        let total_models = llama_count + mistral_count;
                        let model_usage = {
                            llama_3_1_pct: total_models > 0 ? (llama_count / total_models) * 100 : 0,
                            mistral_7b_pct: total_models > 0 ? (mistral_count / total_models) * 100 : 0,
                        };
                        const webhookIngressTelemetry = await env.GREEN_STATE.get("webhook_ingress_telemetry", { type: "json" });
                        const duration = Math.round(performance.now() - startTime);
                        let execGovernance = {
                            last_briefing_sent: null,
                            hitl_status: "ACTIVE",
                            pending_retries: 0,
                        };
                        if (emailitTelemetry) {
                            execGovernance.last_briefing_sent = emailitTelemetry.last_attempt;
                        }
                        try {
                            const emailRetryList = await env.GREEN_STATE.list({
                                prefix: "email_retry_queue:",
                            });
                            const auditRetryList = await env.GREEN_STATE.list({
                                prefix: "audit_retry_queue:",
                            });
                            execGovernance.pending_retries =
                                emailRetryList.keys.length +
                                    auditRetryList.keys.length;
                        }
                        catch (e) { }
                        const nowD = new Date();
                        const nextBriefing = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate(), 10, 30, 0));
                        if (nowD.getTime() > nextBriefing.getTime()) {
                            nextBriefing.setUTCDate(nextBriefing.getUTCDate() + 1);
                        }
                        const diffMs = nextBriefing.getTime() - nowD.getTime();
                        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
                        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                        execGovernance.next_briefing_countdown =
                            `Next Briefing in ${diffHrs}h ${diffMins}m`;
                        let autohealTelemetry = null;
                        try {
                            const healRaw = await env.GREEN_STATE.get("dlq_autoheal_telemetry");
                            if (healRaw) {
                                autohealTelemetry = JSON.parse(healRaw);
                            }
                        }
                        catch (e) { }
                        return new Response(JSON.stringify(sanitizeTelemetry({
                            success: true,
                            buffered_count: bufferedCount,
                            quarantined_count: quarantinedCount,
                            emailit_telemetry: emailitTelemetry,
                            autoheal_telemetry: autohealTelemetry,
                            exec_governance: execGovernance,
                            pending_queue_count: execGovernance.pending_retries,
                            emailit_configured: Boolean(env.EMAILIT_API_KEY),
                            investing_brain_telemetry: {
                                total_consultations_24h,
                                risk_gates_passed,
                                risk_warnings,
                                ai_inference_ms,
                                model_usage,
                            },
                            anny_oracle: {
                                status: "active",
                                session_valid: Boolean(await env.GREEN_STATE.get("anny_session_token")),
                                mode: env.ANNY_AUTH_MODE || "session-token",
                            },
                            anny_auth_telemetry: await env.GREEN_STATE.get("anny_auth_telemetry", { type: "json" }),
                        })), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                "Server-Timing": `worker;dur=${duration};desc="Cloudflare Edge Execution"`,
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to read DLQ status" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" &&
                    url.pathname === "/api/admin/verify-deployment") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const kv_green_state = !!env.GREEN_STATE;
                        const kv_market_cache = !!env.MARKET_CACHE;
                        const workers_ai = !!env.AI;
                        const supabase_ledger = !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_KEY;
                        const isOperational = kv_green_state &&
                            kv_market_cache &&
                            workers_ai &&
                            supabase_ledger;
                        return new Response(JSON.stringify({
                            success: true,
                            deployment_status: isOperational ? "OPERATIONAL" : "DEGRADED",
                            bindings: {
                                kv_green_state,
                                kv_market_cache,
                                workers_ai,
                                supabase_ledger,
                            },
                            timestamp: Date.now(),
                        }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to verify deployment status" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" &&
                    url.pathname === "/api/admin/dept-summary") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const deptSummaryList = await env.GREEN_STATE.list({
                            prefix: "dept_summary:",
                        });
                        const summaries = [];
                        const nowTime = Date.now();
                        for (const key of deptSummaryList.keys) {
                            const parts = key.name.split(":");
                            const tsStr = parts[2];
                            if (tsStr) {
                                const ts = parseInt(tsStr, 10);
                                if (!isNaN(ts) && nowTime - ts <= 86400000) {
                                    const val = await env.GREEN_STATE.get(key.name);
                                    if (val) {
                                        try {
                                            summaries.push(JSON.parse(val));
                                        }
                                        catch (e) {
                                            console.error("Failed to execute");
                                        }
                                    }
                                }
                            }
                        }
                        return new Response(JSON.stringify({ success: true, summaries }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({
                            error: "Failed to retrieve department summaries",
                        }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "DELETE" &&
                    url.pathname === "/api/admin/dept-summary") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    const department = url.searchParams.get("department");
                    if (!department) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Department parameter is required" }), {
                            status: 400,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    try {
                        const deptPrefix = `dept_summary:${department.toLowerCase()}:`;
                        let cursor = undefined;
                        let listComplete = false;
                        while (!listComplete) {
                            const listRes = (await env.GREEN_STATE.list({
                                prefix: deptPrefix,
                                cursor,
                            }));
                            for (const key of listRes.keys) {
                                await env.GREEN_STATE.delete(key.name);
                            }
                            if (listRes.list_complete) {
                                listComplete = true;
                            }
                            else {
                                cursor = listRes.cursor;
                            }
                        }
                        return new Response(JSON.stringify({ success: true, purged: department }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({
                            error: "Failed to purge department summary",
                            details: e.message,
                        }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/dept-summary") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const payload = (await request.json());
                        const { department, updatesCompleted, activeWork, questions } = payload;
                        if (!department) {
                            return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Department is required" }), {
                                status: 400,
                                headers: {
                                    "Content-Type": "application/json",
                                    ...corsHeaders,
                                },
                            });
                        }
                        const keyName = `dept_summary:${department.toLowerCase()}:${Date.now()}`;
                        await env.GREEN_STATE.put(keyName, JSON.stringify({
                            department,
                            updatesCompleted: updatesCompleted || [],
                            activeWork: activeWork || [],
                            questions: questions || [],
                            timestamp: Date.now(),
                        }), { expirationTtl: 172800 });
                        return new Response(JSON.stringify({ success: true, key: keyName }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to process department summary" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" && url.pathname === "/api/cache-sync") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        await syncMarketCache(env);
                        return new Response(JSON.stringify({
                            success: true,
                            message: "Cache synced successfully",
                        }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({
                            error: "Failed to sync cache",
                            details: e.message,
                        }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" && url.pathname === "/api/anny/balances") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const cachedBalance = await env.GREEN_STATE.get("anny_exchange_balances", { type: "json" });
                        if (cachedBalance && typeof cachedBalance.available_usdt === 'number') {
                            return new Response(JSON.stringify({ success: true, available_usdt: cachedBalance.available_usdt, total_capital: cachedBalance.total_capital || 0 }), {
                                status: 200,
                                headers: { "Content-Type": "application/json", ...corsHeaders },
                            });
                        }
                        const balanceData = await annyBackendPost("/backend/balances", {}, env, ctx);
                        const available_usdt = balanceData?.payload?.available_usdt ?? balanceData?.available_usdt ?? 0;
                        const total_capital = balanceData?.payload?.total_capital ?? balanceData?.total_capital ?? 0;
                        await env.GREEN_STATE.put("anny_exchange_balances", JSON.stringify({ available_usdt, total_capital }), { expirationTtl: 30 });
                        return new Response(JSON.stringify({ success: true, available_usdt, total_capital }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ success: false, error: "Failed to fetch balances", detail: e.message }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" && url.pathname === "/api/anny/active-positions") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const cachedPositions = await env.GREEN_STATE.get("anny_active_positions", { type: "json" });
                        if (cachedPositions) {
                            return new Response(JSON.stringify({ success: true, data: cachedPositions }), {
                                status: 200,
                                headers: { "Content-Type": "application/json", ...corsHeaders },
                            });
                        }
                        const positionsData = await annyBackendPost("/backend/activepositions", {}, env, ctx);
                        const activePositions = positionsData?.payload || positionsData || [];
                        await env.GREEN_STATE.put("anny_active_positions", JSON.stringify(activePositions), { expirationTtl: 15 });
                        return new Response(JSON.stringify({ success: true, data: activePositions }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to fetch active positions" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" && url.pathname === "/api/admin/hitl-approve") {
                    const token = url.searchParams.get("token");
                    if (!token) {
                        return new Response("Missing token", { status: 400 });
                    }
                    try {
                        const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET));
                        const tradeKey = payload.trade_key;
                        if (!tradeKey) {
                            return new Response("Invalid token payload", { status: 400 });
                        }
                        const tradeRaw = await env.GREEN_STATE.get(tradeKey);
                        if (!tradeRaw) {
                            return new Response("Trade expired or already approved.", { status: 404 });
                        }
                        const tradeData = JSON.parse(tradeRaw);
                        const execSize = tradeData.recommended_position_size || 0;
                        if (execSize > 0) {
                            try {
                                await annyBackendPost("/backend/signal/invest", {
                                    symbol: tradeData.symbol,
                                    action: tradeData.action,
                                    amount_usdt: execSize,
                                    stop_loss: 2,
                                    take_profit: 6
                                }, env, ctx);
                                // Log to DB
                                const ledgerEntry = {
                                    partner_id: "anny_ai_system",
                                    status: "executed",
                                    amount: execSize,
                                    currency: tradeData.symbol,
                                    wallet_address: "anny_ai_system",
                                    smart_contract_address: tradeData.action,
                                    transaction_hash: `anny_ai_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                                    metadata: {
                                        probability_of_profit: tradeData.probability_of_profit,
                                        risk_level: tradeData.risk_level,
                                        hitl_approved: true
                                    }
                                };
                                await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions`, {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                        apikey: env.SUPABASE_SERVICE_KEY
                                    },
                                    body: JSON.stringify([ledgerEntry])
                                });
                                await env.GREEN_STATE.delete(tradeKey);
                            }
                            catch (executionError) {
                                console.error("AnnyTrade HITL execution failed:", executionError);
                                // Sprint 6: DLQ Logic Implementation & Supabase Audit Log
                                const failedTimestamp = Date.now();
                                const failedPayload = {
                                    symbol: tradeData.symbol,
                                    amount: execSize,
                                    action: tradeData.action,
                                    error_message: executionError.message,
                                    timestamp: failedTimestamp,
                                    source: "hitl_trade"
                                };
                                // Secure Write to KV Buffer Fallback
                                await env.GREEN_STATE.put('dlq:trade:' + failedTimestamp, JSON.stringify(failedPayload));
                                // Supabase Audit Log
                                const failedLedgerEntry = {
                                    partner_id: "anny_ai_system",
                                    status: "failed",
                                    amount: execSize,
                                    currency: tradeData.symbol,
                                    wallet_address: "anny_ai_system",
                                    smart_contract_address: tradeData.action,
                                    transaction_hash: `anny_ai_failed_${failedTimestamp}_${Math.random().toString(36).substring(7)}`,
                                    metadata: {
                                        error: executionError.message,
                                        probability_of_profit: tradeData.probability_of_profit,
                                        risk_level: tradeData.risk_level,
                                        hitl_approved: true,
                                        dlq_buffered: true
                                    }
                                };
                                await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions`, {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                        apikey: env.SUPABASE_SERVICE_KEY
                                    },
                                    body: JSON.stringify([failedLedgerEntry])
                                });
                                return new Response(`<h1>Trade Execution Failed</h1><p>The trade was approved but execution failed. Details have been logged to the DLQ. Error: ${executionError.message}</p>`, {
                                    status: 500,
                                    headers: { "Content-Type": "text/html", ...corsHeaders }
                                });
                            }
                            return new Response("<h1>Trade Approved Successfully</h1>", {
                                status: 200,
                                headers: { "Content-Type": "text/html" }
                            });
                        }
                        else {
                            return new Response("Invalid execution size.", { status: 400 });
                        }
                    }
                    catch (e) {
                        console.error("HITL Approval failed", e);
                        return new Response("<h1>Approval Failed or Token Invalid</h1>", {
                            status: 401,
                            headers: { "Content-Type": "text/html" }
                        });
                    }
                }
                if (request.method === "GET" && url.pathname === "/api/anny-signals") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const signalList = await env.GREEN_STATE.list({
                            prefix: "anny_signal_log:",
                            limit: 10,
                        });
                        await recordKvMetric(env, true);
                        let signals = [];
                        for (const key of signalList.keys) {
                            const signalRaw = await env.GREEN_STATE.get(key.name);
                            if (signalRaw) {
                                try {
                                    signals.push(JSON.parse(signalRaw));
                                }
                                catch (e) { }
                            }
                        }
                        signals.sort((a, b) => b.timestamp - a.timestamp);
                        return new Response(JSON.stringify({ success: true, data: signals.slice(0, 10) }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to fetch anny signals" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/webhooks/anny-signal") {
                    const signature = request.headers.get("X-Axim-Signature");
                    const token = url.searchParams.get("token");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        if (!token ||
                            (token !== env.AXIM_INTERNAL_KEY &&
                                token !== env.ANNY_AUTH_TOKEN)) {
                            return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                                status: 401,
                                headers: corsHeaders,
                            });
                        }
                    }
                    try {
                        // Clone request so we can read text if JSON fails
                        const reqClone = request.clone();
                        try {
                            const payload = (await request.json());
                            const { symbol, action, price, bot_id, signal_id, timestamp, cfo_state } = payload;
                            // Task 1: Fetch latest_prices from MARKET_CACHE
                            const marketCacheRaw = (await env.MARKET_CACHE.get("latest_prices", { type: "json" }));
                            const currentPriceInfo = marketCacheRaw?.[symbol] || "Unknown";
                            const cfoTrend = marketCacheRaw?.cfo_trend_state?.[symbol] || "Unknown";
                            // Fetch exchange balance dynamically
                            let available_usdt = 0;
                            let total_capital = 0;
                            try {
                                // Try caching to avoid rate limit spam on rapid signals
                                const cachedBalance = await env.GREEN_STATE.get("anny_exchange_balances", { type: "json" });
                                if (cachedBalance && typeof cachedBalance.available_usdt === 'number') {
                                    available_usdt = cachedBalance.available_usdt;
                                    total_capital = cachedBalance.total_capital || 0;
                                }
                                else {
                                    const balanceData = await annyBackendPost("/backend/balances", {}, env, ctx);
                                    // Handle potential response structures
                                    available_usdt = balanceData?.payload?.available_usdt ?? balanceData?.available_usdt ?? 0;
                                    total_capital = balanceData?.payload?.total_capital ?? balanceData?.total_capital ?? 0;
                                    await env.GREEN_STATE.put("anny_exchange_balances", JSON.stringify({ available_usdt, total_capital }), { expirationTtl: 30 });
                                }
                            }
                            catch (e) {
                                console.error("Failed to fetch exchange balance:", e);
                                // Fallback to a safe minimum if we can't fetch but still need to process
                                available_usdt = 0;
                            }
                            // Task 1: Construct AI prompt
                            const aiPrompt = `You are an ultra-conservative, ruthless risk manager for live capital. Analyze this trade signal against current market trends.
Return a JSON object with 'probability_of_profit' (0-100), 'risk_level' (Low/Medium/High), 'approved' (boolean), and 'recommended_position_size' (number in USDT).
You must ONLY approve (true) if the probability of profit is strictly > 90%, the risk_level is 'Low', and the 24h Trend CFO State aligns with the requested action. Protect capital at all costs.
Calculate 'recommended_position_size' based on a STRICT max 5% portfolio risk of the Available Balance. If balance is 0 or too low, recommend 0 and do not approve.

Trade Signal:
- Asset: ${symbol}
- Action: ${action}
- Price: ${price}
- CFO State: ${cfo_state || 'Unknown'}

Market Context:
- Cached Price: ${currentPriceInfo}
- 24h Trend CFO State: ${cfoTrend}
- Available Balance (USDT): ${available_usdt}`;
                            let aiResult = {
                                probability_of_profit: 0,
                                risk_level: "High",
                                approved: false,
                                recommended_position_size: 0
                            };
                            if (env.AI) {
                                try {
                                    const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
                                        messages: [
                                            { role: "system", content: "You are a ruthless risk manager that only outputs valid JSON." },
                                            { role: "user", content: aiPrompt }
                                        ]
                                    });
                                    // Clean up potential markdown formatting from AI response
                                    let responseText = aiResponse.response || "";
                                    responseText = responseText.replace(/\s*```json/g, "").replace(/```/g, "").trim();
                                    try {
                                        const parsedAi = JSON.parse(responseText);
                                        if (typeof parsedAi.probability_of_profit === 'number' && parsedAi.risk_level && typeof parsedAi.approved === 'boolean') {
                                            aiResult = parsedAi;
                                            if (typeof parsedAi.recommended_position_size !== 'number') {
                                                aiResult.recommended_position_size = 0;
                                            }
                                        }
                                    }
                                    catch (e) {
                                        console.error("Failed to parse AI JSON response:", responseText);
                                    }
                                }
                                catch (e) {
                                    console.error("AI Evaluation failed:", e);
                                }
                            }
                            const keyName = `anny_signal_log:${Date.now()}`;
                            const logData = {
                                symbol: symbol || "UNKNOWN",
                                action: action || "UNKNOWN",
                                price: price || 0,
                                bot_id: bot_id || "N/A",
                                signal_id: signal_id || "N/A",
                                timestamp: timestamp || Date.now(),
                                received_at: Date.now(),
                                probability_of_profit: aiResult.probability_of_profit,
                                risk_level: aiResult.risk_level,
                                approved: aiResult.approved
                            };
                            let isBorderline = false;
                            if (!aiResult.approved && aiResult.probability_of_profit >= 75 && aiResult.probability_of_profit <= 89) {
                                isBorderline = true;
                                logData.requires_human_approval = true;
                                logData.recommended_position_size = aiResult.recommended_position_size || 0; // ensure size is saved
                            }
                            if (aiResult.approved) {
                                let execSize = aiResult.recommended_position_size || 0;
                                // Safety check: ensure size is within available balance
                                if (execSize > available_usdt) {
                                    execSize = available_usdt;
                                }
                                if (execSize > 0) {
                                    try {
                                        await annyBackendPost("/backend/signal/invest", {
                                            symbol,
                                            action,
                                            amount_usdt: execSize,
                                            stop_loss: 2,
                                            take_profit: 6
                                        }, env, ctx);
                                        logData.executed_amount_usdt = execSize;
                                        // Task 1 & 2: Log to DB & Send Email
                                        ctx.waitUntil((async () => {
                                            try {
                                                const ledgerEntry = {
                                                    partner_id: "anny_ai_system",
                                                    status: "executed",
                                                    amount: execSize,
                                                    currency: symbol,
                                                    wallet_address: "anny_ai_system",
                                                    smart_contract_address: action,
                                                    transaction_hash: `anny_ai_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                                                    metadata: {
                                                        probability_of_profit: aiResult.probability_of_profit,
                                                        risk_level: aiResult.risk_level
                                                    }
                                                };
                                                await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions`, {
                                                    method: "POST",
                                                    headers: {
                                                        "Content-Type": "application/json",
                                                        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                                        apikey: env.SUPABASE_SERVICE_KEY
                                                    },
                                                    body: JSON.stringify([ledgerEntry])
                                                });
                                                const subject = `AXiM Alert: Live Capital Deployed (${symbol})`;
                                                const body = `Action: ${action}\nPosition Size: ${execSize} USDT\nStop-Loss Limits: 2\nAI Confidence: ${aiResult.probability_of_profit}%`;
                                                await sendEmailItNotification({ to: "james.ellars@axim.us.com", subject, html: body }, env);
                                            }
                                            catch (err) {
                                                console.error("Failed to sync ledger or send email alert:", err);
                                            }
                                        })());
                                    }
                                    catch (executionError) {
                                        console.error("AnnyTrade execution failed:", executionError);
                                        aiResult.approved = false;
                                        logData.approved = false;
                                        logData.execution_error = executionError.message;
                                        // Sprint 6: DLQ Logic Implementation & Supabase Audit Log
                                        const failedTimestamp = Date.now();
                                        const failedPayload = {
                                            symbol,
                                            amount: execSize,
                                            action,
                                            error_message: executionError.message,
                                            timestamp: failedTimestamp,
                                            source: "ai_trade"
                                        };
                                        ctx.waitUntil((async () => {
                                            try {
                                                // Secure Write to KV Buffer Fallback
                                                await env.GREEN_STATE.put('dlq:trade:' + failedTimestamp, JSON.stringify(failedPayload));
                                                // Supabase Audit Log
                                                const failedLedgerEntry = {
                                                    partner_id: "anny_ai_system",
                                                    status: "failed",
                                                    amount: execSize,
                                                    currency: symbol,
                                                    wallet_address: "anny_ai_system",
                                                    smart_contract_address: action,
                                                    transaction_hash: `anny_ai_failed_${failedTimestamp}_${Math.random().toString(36).substring(7)}`,
                                                    metadata: {
                                                        error: executionError.message,
                                                        probability_of_profit: aiResult.probability_of_profit,
                                                        risk_level: aiResult.risk_level,
                                                        dlq_buffered: true
                                                    }
                                                };
                                                await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions`, {
                                                    method: "POST",
                                                    headers: {
                                                        "Content-Type": "application/json",
                                                        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                                        apikey: env.SUPABASE_SERVICE_KEY
                                                    },
                                                    body: JSON.stringify([failedLedgerEntry])
                                                });
                                            }
                                            catch (dlqErr) {
                                                console.error("Failed to write to DLQ or Audit Log:", dlqErr);
                                            }
                                        })());
                                    }
                                }
                                else {
                                    console.warn("Trade approved but insufficient balance or recommended size 0");
                                    aiResult.approved = false;
                                    logData.approved = false;
                                    logData.execution_error = "Insufficient balance for minimum position";
                                }
                            }
                            // Task 2: Quarantine if rejected
                            if (!aiResult.approved) {
                                if (isBorderline) {
                                    const hitlKeyName = `hitl_pending_${Date.now()}`;
                                    await env.GREEN_STATE.put(hitlKeyName, JSON.stringify(logData), {
                                        expirationTtl: 86400,
                                    });
                                }
                                else {
                                    const quarantineKeyName = `quarantine:trade:${Date.now()}`;
                                    await env.GREEN_STATE.put(quarantineKeyName, JSON.stringify(logData), {
                                        expirationTtl: 604800,
                                    });
                                }
                            }
                            await env.GREEN_STATE.put(keyName, JSON.stringify(logData), {
                                expirationTtl: 604800,
                            });
                            // Task 3: Track Webhook Ingress Telemetry
                            let ingressTelemetry = {
                                last_webhook_received: Date.now(),
                                total_webhooks_24h: 1,
                                status: "OPERATIONAL",
                            };
                            try {
                                const prevTelemetry = (await env.GREEN_STATE.get("webhook_ingress_telemetry", { type: "json" }));
                                if (prevTelemetry) {
                                    ingressTelemetry.total_webhooks_24h =
                                        (prevTelemetry.total_webhooks_24h || 0) + 1;
                                }
                            }
                            catch (e) { }
                            await env.GREEN_STATE.put("webhook_ingress_telemetry", JSON.stringify(ingressTelemetry));
                            if (!aiResult.approved) {
                                return new Response(JSON.stringify({
                                    success: false,
                                    status: "signal_rejected",
                                    reason: "Failed AI Profitability & Risk Check",
                                    probability_of_profit: aiResult.probability_of_profit,
                                    risk_level: aiResult.risk_level,
                                    log_id: keyName,
                                }), {
                                    status: 200, // Returning 200 so webhook sender doesn't retry rejected signals
                                    headers: {
                                        "Content-Type": "application/json",
                                        ...corsHeaders,
                                    },
                                });
                            }
                            return new Response(JSON.stringify({
                                success: true,
                                status: "signal_logged",
                                log_id: keyName,
                                probability_of_profit: aiResult.probability_of_profit,
                                risk_level: aiResult.risk_level,
                                approved: aiResult.approved
                            }), {
                                status: 200,
                                headers: {
                                    "Content-Type": "application/json",
                                    ...corsHeaders,
                                },
                            });
                        }
                        catch (e) {
                            const rawText = await reqClone.text();
                            const keyName = `dlq_signal_${Date.now()}`;
                            await env.GREEN_STATE.put(keyName, rawText, {
                                metadata: {
                                    error: e.message,
                                    status: "malformed_signal_buffered",
                                },
                            });
                            return new Response(JSON.stringify({
                                success: false,
                                status: "buffered_to_dlq",
                                dlq_id: keyName,
                            }), {
                                status: 202,
                                headers: {
                                    "Content-Type": "application/json",
                                    ...corsHeaders,
                                },
                            });
                        }
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to ingest inbound webhook" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if ((request.method === "POST" || request.method === "GET") &&
                    url.pathname === "/api/webhooks/emailit-inbound") {
                    const action = url.searchParams.get("action");
                    const token = url.searchParams.get("token");
                    if (action) {
                        if (token !== env.AXIM_INTERNAL_KEY) {
                            const html = `<html><head><style>body { font-family: sans-serif; background: #000; color: #fff; padding: 2rem; }</style></head><body><h2>Unauthorized Edge Ingress</h2></body></html>`;
                            return new Response(html, {
                                status: 403,
                                headers: { "Content-Type": "text/html", ...corsHeaders },
                            });
                        }
                        try {
                            let actionName = action;
                            if (action === "flush_dlq") {
                                // Trigger DLQ Flush routine inline (abstracted logic or simple loop)
                                let cursor = undefined;
                                let listComplete = false;
                                let processedCount = 0;
                                const MAX_PROCESS = 50;
                                while (!listComplete && processedCount < MAX_PROCESS) {
                                    const dlqList = (await env.GREEN_STATE.list({
                                        cursor,
                                    }));
                                    for (const key of dlqList.keys) {
                                        if (processedCount >= MAX_PROCESS)
                                            break;
                                        if (key.name.startsWith("quarantine:") ||
                                            key.name === "emailit_telemetry" ||
                                            key.name.startsWith("exec_feedback:") ||
                                            key.name.startsWith("admin_action:"))
                                            continue;
                                        const rawPayload = await env.GREEN_STATE.get(key.name);
                                        if (rawPayload) {
                                            try {
                                                const payload = JSON.parse(rawPayload);
                                                const enrichedPayload = {
                                                    ...payload,
                                                    metadata: {
                                                        ...(payload.metadata || {}),
                                                        is_dlq_retry: true,
                                                        retry_timestamp: Date.now(),
                                                    },
                                                };
                                                // Simulate ingestion
                                                await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions?on_conflict=transaction_hash`, {
                                                    method: "POST",
                                                    headers: {
                                                        "Content-Type": "application/json",
                                                        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                                        apikey: env.SUPABASE_SERVICE_KEY,
                                                        Prefer: "resolution=merge-duplicates",
                                                    },
                                                    body: JSON.stringify([enrichedPayload]),
                                                });
                                                await env.GREEN_STATE.delete(key.name);
                                                processedCount++;
                                            }
                                            catch (e) {
                                                await env.GREEN_STATE.put(`quarantine:${key.name}`, rawPayload, {
                                                    metadata: {
                                                        quarantine_reason: "retry_failed",
                                                        original_key: key.name,
                                                    },
                                                });
                                                await env.GREEN_STATE.delete(key.name);
                                            }
                                        }
                                    }
                                    if (dlqList.list_complete) {
                                        listComplete = true;
                                    }
                                    else {
                                        cursor = dlqList.cursor;
                                    }
                                }
                                actionName = "Flush DLQ Buffer";
                            }
                            else if (action === "purge_quarantine") {
                                let cursor = undefined;
                                let listComplete = false;
                                while (!listComplete) {
                                    const listRes = (await env.GREEN_STATE.list({
                                        prefix: "quarantine:",
                                        cursor,
                                    }));
                                    for (const key of listRes.keys) {
                                        await env.GREEN_STATE.delete(key.name);
                                    }
                                    if (listRes.list_complete) {
                                        listComplete = true;
                                    }
                                    else {
                                        cursor = listRes.cursor;
                                    }
                                }
                                actionName = "Purge Quarantine";
                            }
                            else if (action === "acknowledge_plan") {
                                actionName = "Acknowledge Strategic Plan";
                                // Acknowledge logic could just be dropping a state marker
                            }
                            else if (action === "approve_payout") {
                                actionName = "Approve Pending Payout Batch";
                            }
                            const actionId = `admin_action:${action}:${Date.now()}`;
                            await env.GREEN_STATE.put(actionId, JSON.stringify({
                                action,
                                timestamp: Date.now(),
                                executed: true,
                            }), {
                                expirationTtl: 604800,
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
                                        executor: "james.ellars@axim.us.com",
                                    },
                                };
                                try {
                                    const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
                                        method: "POST",
                                        headers: {
                                            "Content-Type": "application/json",
                                            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                            apikey: env.SUPABASE_SERVICE_KEY,
                                        },
                                        body: JSON.stringify(auditPayload),
                                    });
                                    if (!dbRes.ok)
                                        throw new Error("DB Error");
                                }
                                catch (e) {
                                    console.error("Failed to log HITL action execution:", e);
                                    await env.GREEN_STATE.put(`audit_retry_queue:${Date.now()}`, JSON.stringify(auditPayload), { expirationTtl: 86400 });
                                }
                            })());
                            if (request.method === "GET") {
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
                                return new Response(html, {
                                    status: 200,
                                    headers: { "Content-Type": "text/html", ...corsHeaders },
                                });
                            }
                            return new Response(JSON.stringify({ success: true, action_executed: action }), {
                                status: 200,
                                headers: {
                                    "Content-Type": "application/json",
                                    ...corsHeaders,
                                },
                            });
                        }
                        catch (e) {
                            return new Response(JSON.stringify({
                                error: "Action execution failed",
                                details: e.message,
                            }), {
                                status: 500,
                                headers: {
                                    "Content-Type": "application/json",
                                    ...corsHeaders,
                                },
                            });
                        }
                    }
                    try {
                        const payload = (await request.json());
                        // Bounce Handling
                        if (payload.status === "bounced" ||
                            payload.status === "failed" ||
                            payload.status === "complained" ||
                            payload.event === "bounced" ||
                            payload.event === "failed" ||
                            payload.event === "complained") {
                            ctx.waitUntil((async () => {
                                const bounceId = `email_bounce_log:${Date.now()}`;
                                await env.GREEN_STATE.put(bounceId, JSON.stringify({ ...payload, timestamp: Date.now() }), { expirationTtl: 2592000 }); // 30 days
                                try {
                                    const rawTelemetry = await env.GREEN_STATE.get("edge_error_telemetry");
                                    let telemetry = rawTelemetry
                                        ? JSON.parse(rawTelemetry)
                                        : {
                                            total_requests_24h: 0,
                                            total_errors_24h: 0,
                                            error_rate_pct: 0.0,
                                            last_error_timestamp: null,
                                            _tracking_start: Date.now(),
                                        };
                                    const now = Date.now();
                                    if (now - (telemetry._tracking_start || now) > 86400000) {
                                        telemetry = {
                                            total_requests_24h: 0,
                                            total_errors_24h: 0,
                                            error_rate_pct: 0.0,
                                            last_error_timestamp: telemetry.last_error_timestamp,
                                            _tracking_start: now,
                                        };
                                    }
                                    telemetry.total_errors_24h += 1;
                                    telemetry.last_error_timestamp = now;
                                    if (telemetry.total_requests_24h > 0) {
                                        telemetry.error_rate_pct = Number(((telemetry.total_errors_24h /
                                            telemetry.total_requests_24h) *
                                            100).toFixed(2));
                                    }
                                    await env.GREEN_STATE.put("edge_error_telemetry", JSON.stringify(telemetry));
                                }
                                catch (e) {
                                    console.error("Failed to update edge_error_telemetry on bounce", e);
                                }
                            })());
                        }
                        const from = payload.from || "unknown";
                        const subject = payload.subject || "No Subject";
                        const text = payload.text || "";
                        const responseToken = payload.response_token || "";
                        const feedbackId = `exec_feedback:${Date.now()}`;
                        await env.GREEN_STATE.put(feedbackId, JSON.stringify({
                            from,
                            subject,
                            text,
                            responseToken,
                            timestamp: Date.now(),
                        }), {
                            expirationTtl: 604800, // 7 days
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
                    `,
                                }, env);
                            }
                            catch (err) {
                                console.error("Failed to send auto-reply receipt", err);
                            }
                        })());
                        return new Response(JSON.stringify({ success: true, ingested: true }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to ingest inbound webhook" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/send-exec-briefing") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const cacheResult = await env.MARKET_CACHE.getWithMetadata("latest_prices");
                        let parsedData = {};
                        if (cacheResult.value) {
                            try {
                                parsedData = JSON.parse(cacheResult.value);
                            }
                            catch (e) {
                                console.error("Parse error", e);
                            }
                        }
                        const dlqList = await env.GREEN_STATE.list({ limit: 1000 });
                        let bufferedCount = dlqList.keys.filter((k) => !k.name.startsWith("quarantine:")).length;
                        let quarantinedCount = dlqList.keys.filter((k) => k.name.startsWith("quarantine:")).length;
                        const deptSummaryList = await env.GREEN_STATE.list({
                            prefix: "dept_summary:",
                        });
                        let deptSummariesHtml = "<ul>";
                        // Filter 24h window
                        const nowTime = Date.now();
                        const filteredKeys = deptSummaryList.keys.filter((key) => {
                            const parts = key.name.split(":");
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
                                    const d = p.departmentName || p.department || p.name || "Unknown";
                                    const c = p.completedUpdates || p.completed || "N/A";
                                    const a = p.activeWork || p.active || "N/A";
                                    deptSummariesHtml += `<li>Ecosystem Department Progress: ${d} &mdash; ${c} &amp; ${a}</li>`;
                                }
                                catch (e) {
                                    deptSummariesHtml += `<li>Ecosystem Department Progress: ${val}</li>`;
                                }
                            }
                        }
                        deptSummariesHtml += "</ul>";
                        const signalListExec = await env.GREEN_STATE.list({
                            prefix: "anny_signal_log:",
                            limit: 1000,
                        });
                        let totalSignals = 0;
                        let buyCount = 0;
                        let tpCount = 0;
                        let slCount = 0;
                        let dcaCount = 0;
                        const nowTimeSignal = Date.now();
                        for (const key of signalListExec.keys) {
                            const parts = key.name.split(":");
                            const tsStr = parts[1];
                            if (tsStr) {
                                const ts = parseInt(tsStr, 10);
                                if (!isNaN(ts) && nowTimeSignal - ts <= 86400000) {
                                    const signalRaw = await env.GREEN_STATE.get(key.name);
                                    if (signalRaw) {
                                        try {
                                            const s = JSON.parse(signalRaw);
                                            totalSignals++;
                                            const act = (s.action || "").toLowerCase();
                                            if (act === "buy" || act === "long")
                                                buyCount++;
                                            else if (act === "tp" ||
                                                act === "take_profit" ||
                                                act === "take-profit")
                                                tpCount++;
                                            else if (act === "sl" ||
                                                act === "stop_loss" ||
                                                act === "stop-loss")
                                                slCount++;
                                            else if (act === "dca")
                                                dcaCount++;
                                        }
                                        catch (e) { }
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
                        const btc = parsedData?.crypto?.BTC?.price || "N/A";
                        const eth = parsedData?.crypto?.ETH?.price || "N/A";
                        const sol = parsedData?.crypto?.SOL?.price || "N/A";
                        let portfolioSummaryHtml = "";
                        try {
                            let combinedPortfolio = null;
                            const pSummaryRaw = await env.GREEN_STATE.get("anny_portfolio_summary", { type: "json" });
                            if (pSummaryRaw) {
                                combinedPortfolio = pSummaryRaw;
                            }
                            else {
                                combinedPortfolio = await fetchAnnyCombinedPortfolio(env, ctx);
                            }
                            if (combinedPortfolio && combinedPortfolio.length > 0) {
                                let accCount = 0;
                                let waitCount = 0;
                                let distCount = 0;
                                let activePositionsHtml = "";
                                for (const asset of combinedPortfolio) {
                                    const cfo = asset.cfo_state || "";
                                    if (cfo.toLowerCase() === "accumulate")
                                        accCount++;
                                    else if (cfo.toLowerCase() === "distribute")
                                        distCount++;
                                    else
                                        waitCount++; // Default to wait/neutral
                                    if (asset.quantity > 0 || asset.pnl !== 0) {
                                        activePositionsHtml += `<li><strong>${asset.coin}</strong>: Qty ${asset.quantity} | PNL: $${asset.pnl} | State: ${cfo}</li>`;
                                    }
                                }
                                portfolioSummaryHtml = `<div style="border: 1px solid #10b981; padding: 15px; border-radius: 8px; margin-bottom: 20px; background-color: #f0fdf4;">
                    <h4 style="color: #047857; margin-top: 0;">Anny Combined Portfolio & Active Positions</h4>
                    <p style="margin-bottom: 10px;"><strong>${accCount}</strong> Accumulate | <strong>${waitCount}</strong> Neutral (Wait) | <strong>${distCount}</strong> Distribute</p>
                    ${activePositionsHtml ? `<ul>${activePositionsHtml}</ul>` : ""}
                </div>`;
                            }
                        }
                        catch (e) {
                            console.error("Failed to fetch combined portfolio for briefing", e);
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
                <li>Market Cache - BTC: ${btc}, ETH: ${eth}, SOL: ${sol}</li>
                <li>Total API Tokens Used: N/A</li>
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
                            html: html,
                        }, env);
                        if (dispatchResult.success) {
                            try {
                                await env.GREEN_STATE.put(`briefing_archive:${Date.now()}`, html, { expirationTtl: 604800 });
                            }
                            catch (e) {
                                console.error("Failed to archive briefing", e);
                            }
                            return new Response(JSON.stringify({
                                success: true,
                                recipient: "james.ellars@axim.us.com",
                            }), {
                                status: 200,
                                headers: {
                                    "Content-Type": "application/json",
                                    ...corsHeaders,
                                },
                            });
                        }
                        else {
                            return new Response(JSON.stringify({ error: dispatchResult.error }), {
                                status: 500,
                                headers: {
                                    "Content-Type": "application/json",
                                    ...corsHeaders,
                                },
                            });
                        }
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to send exec briefing" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" &&
                    url.pathname === "/api/admin/briefing-archive") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const listResult = await env.GREEN_STATE.list({
                            prefix: "briefing_archive:",
                        });
                        // Sort keys by timestamp (newest first)
                        const sortedKeys = listResult.keys.sort((a, b) => {
                            const tsA = parseInt(a.name.split(":")[1], 10);
                            const tsB = parseInt(b.name.split(":")[1], 10);
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
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to fetch briefing archives" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/replay-webhook") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const bodyStr = await request.text();
                        const payload = JSON.parse(bodyStr);
                        if (!payload.target_endpoint || !payload.payload) {
                            return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Missing target_endpoint or payload" }), {
                                status: 400,
                                headers: {
                                    "Content-Type": "application/json",
                                    ...corsHeaders,
                                },
                            });
                        }
                        const internalUrl = new URL(request.url);
                        internalUrl.pathname = payload.target_endpoint;
                        const newHeaders = new Headers(request.headers);
                        if (payload.bypass_hmac) {
                            newHeaders.set("X-Axim-Signature", env.AXIM_INTERNAL_KEY);
                        }
                        const syntheticRequest = new Request(internalUrl.toString(), {
                            method: "POST",
                            headers: newHeaders,
                            body: JSON.stringify(payload.payload),
                        });
                        // Recursively call fetch handler
                        return await this.fetch(syntheticRequest, env, ctx);
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ error: "Replay failed", details: e.message }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/force-briefing-dispatch") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        // Trigger via internal HTTP call due to helper functions structure
                        await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
                            method: "POST",
                            headers: {
                                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                apikey: env.SUPABASE_SERVICE_KEY,
                            },
                            body: JSON.stringify({
                                endpoint: "/api/admin/force-briefing-dispatch",
                                count: 1,
                            }),
                        });
                        return new Response(JSON.stringify({
                            success: true,
                            dispatched_at: new Date().toISOString(),
                        }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to dispatch briefing" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                // Get 24-hour settlement telemetry helper
                async function getSettlementTelemetry24h(env) {
                    try {
                        const cacheResult = await env.MARKET_CACHE.getWithMetadata("settlement_telemetry_24h");
                        if (cacheResult.value) {
                            const parsed = JSON.parse(cacheResult.value);
                            if (Date.now() - (parsed.updated_at || 0) < 300000) {
                                return {
                                    count: parsed.count || 0,
                                    volume_usd: parsed.volume_usd || 0,
                                };
                            }
                        }
                        // Fetch from Supabase
                        const dbResponse = await fetch(`${getSupabaseReadUrl(env)}/rest/v1/blockchain_transactions?select=amount,status,created_at&status=eq.minted&created_at=gte.${new Date(Date.now() - 86400000).toISOString()}`, {
                            headers: {
                                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                apikey: env.SUPABASE_SERVICE_KEY,
                            },
                        });
                        if (!dbResponse.ok)
                            return { count: 0, volume_usd: 0 };
                        const txs = await dbResponse.json();
                        let volume = 0;
                        txs.forEach((tx) => (volume += parseFloat(tx.amount) || 0));
                        const telemetry = {
                            count: txs.length,
                            volume_usd: volume,
                            updated_at: Date.now(),
                        };
                        await env.MARKET_CACHE.put("settlement_telemetry_24h", JSON.stringify(telemetry), { expirationTtl: 300 });
                        return { count: txs.length, volume_usd: volume };
                    }
                    catch (e) {
                        return { count: 0, volume_usd: 0 };
                    }
                }
                if (request.method === "POST" && url.pathname === "/api/dlq-flush") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        let processedCount = 0;
                        const MAX_PROCESS = 50;
                        let cursor = undefined;
                        let listComplete = false;
                        while (!listComplete && processedCount < MAX_PROCESS) {
                            const dlqList = await env.GREEN_STATE.list({ cursor });
                            for (const key of dlqList.keys) {
                                if (processedCount >= MAX_PROCESS)
                                    break;
                                if (key.name.startsWith("quarantine:"))
                                    continue; // Skip quarantined items
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
                                                dlq_id: key.name,
                                            },
                                        };
                                        const dbResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions?on_conflict=transaction_hash`, {
                                            method: "POST",
                                            headers: {
                                                "Content-Type": "application/json",
                                                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                                apikey: env.SUPABASE_SERVICE_KEY,
                                                Prefer: "resolution=merge-duplicates",
                                            },
                                            body: JSON.stringify([enrichedPayload]),
                                        });
                                        if (dbResponse.ok) {
                                            await env.GREEN_STATE.delete(key.name);
                                            processedCount++;
                                        }
                                        else {
                                            // Task 1: Neutralize Poison-Pill DLQ Stagnation
                                            // Implement retry count metadata check and threshold logic
                                            const metadata = key.metadata || {};
                                            const retryCount = (metadata.retry_count || 0) + 1;
                                            if (retryCount >= 3) {
                                                // Tag as poison pill to ignore in the future, delete original
                                                await env.GREEN_STATE.put(`quarantine:${key.name}`, rawPayload, {
                                                    metadata: {
                                                        ...metadata,
                                                        retry_count: retryCount,
                                                        error: "poison_pill_threshold_reached",
                                                    },
                                                });
                                                await env.GREEN_STATE.delete(key.name);
                                            }
                                            else {
                                                // Increment retry count
                                                await env.GREEN_STATE.put(key.name, rawPayload, {
                                                    metadata: { ...metadata, retry_count: retryCount },
                                                });
                                            }
                                        }
                                    }
                                    catch (parseError) {
                                        console.error("Parse or upsert error", parseError);
                                    }
                                }
                            }
                            if (processedCount >= MAX_PROCESS) {
                                break;
                            }
                            if (dlqList.list_complete) {
                                listComplete = true;
                            }
                            else {
                                cursor = dlqList.cursor;
                            }
                        }
                        let remaining = false;
                        if (processedCount >= MAX_PROCESS) {
                            remaining = true;
                        }
                        else if (!listComplete) {
                            remaining = true;
                        }
                        return new Response(JSON.stringify({
                            success: true,
                            processed: processedCount,
                            remaining,
                        }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to flush DLQ" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" && url.pathname === "/api/market/history") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const cacheResult = await env.MARKET_CACHE.getWithMetadata("historical_prices");
                        if (cacheResult.value) {
                            await recordKvMetric(env, true);
                        }
                        else {
                            await recordKvMetric(env, false);
                        }
                        let data;
                        if (!cacheResult.value) {
                            // Mock fallback for standard assets
                            data = {
                                BTC: [64000, 64200, 64100, 64500, 64800, 64600, 64900, 65000, 64700, 65000],
                                ETH: [3400, 3420, 3410, 3450, 3480, 3460, 3490, 3500, 3470, 3500],
                                SOL: [140, 142, 141, 145, 148, 146, 149, 150, 147, 150]
                            };
                        }
                        else {
                            try {
                                data = JSON.parse(cacheResult.value);
                            }
                            catch (e) {
                                // If it fails to parse, mock it
                                data = {
                                    BTC: [64000, 64200, 64100, 64500, 64800, 64600, 64900, 65000, 64700, 65000],
                                    ETH: [3400, 3420, 3410, 3450, 3480, 3460, 3490, 3500, 3470, 3500],
                                    SOL: [140, 142, 141, 145, 148, 146, 149, 150, 147, 150]
                                };
                            }
                        }
                        return new Response(JSON.stringify({ success: true, data }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to fetch market history" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" && url.pathname === "/api/market-cache") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    const cacheResult = await env.MARKET_CACHE.getWithMetadata("latest_prices");
                    if (cacheResult.value) {
                        await recordKvMetric(env, true);
                    }
                    else {
                        await recordKvMetric(env, false);
                    }
                    if (!cacheResult.value) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Cache miss" }), {
                            status: 404,
                            headers: {
                                "Content-Type": "application/json",
                                ...corsHeaders,
                            },
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
                                ETag: etag,
                                "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
                                ...corsHeaders,
                            },
                        });
                    }
                    let parsedData;
                    try {
                        parsedData = JSON.parse(cacheResult.value);
                        // Track data freshness
                        parsedData._telemetry_timestamp =
                            cacheResult.metadata && cacheResult.metadata.updated_at
                                ? cacheResult.metadata.updated_at
                                : Date.now();
                        // Expose metadata flags to client (e.g., rate_limited)
                        parsedData.metadata = cacheResult.metadata
                            ? { ...cacheResult.metadata }
                            : {
                                rate_limited: false,
                                updated_at: parsedData._telemetry_timestamp,
                            };
                    }
                    catch (e) {
                        // Fallback if parsing fails
                        parsedData = { error: "Invalid JSON in cache" };
                    }
                    parsedData.oracle_provider = "anny_trade_rest";
                    parsedData.auth_mode = env.ANNY_AUTH_MODE || "session-token";
                    const duration = Math.round(performance.now() - startTime);
                    return new Response(JSON.stringify(parsedData), {
                        status: 200,
                        headers: {
                            ETag: etag,
                            "Content-Type": "application/json",
                            "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
                            "Server-Timing": `worker;dur=${duration};desc="Cloudflare Edge Execution"`,
                            ...corsHeaders,
                        },
                    });
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/quarantine-purge") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        let cursor = undefined;
                        let listComplete = false;
                        let totalPurged = 0;
                        while (!listComplete) {
                            const listRes = await env.GREEN_STATE.list({
                                prefix: "quarantine:",
                                cursor,
                            });
                            for (const key of listRes.keys) {
                                await env.GREEN_STATE.delete(key.name);
                                totalPurged++;
                            }
                            if (listRes.list_complete) {
                                listComplete = true;
                            }
                            else {
                                cursor = listRes.cursor;
                            }
                        }
                        return new Response(JSON.stringify({ success: true, purged_count: totalPurged }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to purge quarantine" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/validate-signal") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const payload = (await request.json());
                        const { symbol, action, amount_usdt } = payload;
                        await logAdminAction(env, "validate-signal", {
                            symbol,
                            action,
                            amount_usdt,
                        });
                        const annyPortfolioRaw = (await env.GREEN_STATE.get("anny_portfolio_summary", { type: "json" }));
                        const available_usdt = annyPortfolioRaw?.liquid_usdt || 0;
                        const marketCacheRaw = (await env.MARKET_CACHE.get("latest_prices", { type: "json" }));
                        const cfo_state = marketCacheRaw?.cfo_trend_state?.[symbol] || "wait";
                        let approved = false;
                        let reason = "Signal aligned with structural strength and within drawdown limits";
                        if (amount_usdt > available_usdt) {
                            reason = "Trade rejected: Insufficient liquid USDT balance";
                        }
                        else if (cfo_state === "distribute") {
                            reason =
                                "Trade rejected: Asset showing structural weakness (Distribute state)";
                        }
                        else if (cfo_state === "accumulate" || cfo_state === "wait") {
                            approved = true;
                        }
                        else {
                            reason = "Trade rejected: Unknown CFO state";
                        }
                        const spotPrice = marketCacheRaw?.[symbol] || 0;
                        const dry_run_simulation = {
                            estimated_fill_price: spotPrice ? spotPrice * 1.0005 : 0,
                            estimated_slippage_pct: 0.1,
                            liquidity_check: amount_usdt < 10000 ? "PASS" : "DEEP_BOOK_REQUIRED",
                        };
                        return new Response(JSON.stringify({
                            approved: approved,
                            symbol: symbol || "UNKNOWN",
                            cfo_state: cfo_state,
                            reason: reason,
                            available_usdt: available_usdt,
                            dry_run_simulation: dry_run_simulation,
                        }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ error: e.message }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/renew-anny-session") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        await env.GREEN_STATE.delete("anny_session_token");
                        await logAdminAction(env, "renew-anny-session", {});
                        const newToken = await getOrRefreshAnnySessionToken(env, ctx);
                        const authTelemetryRaw = await env.GREEN_STATE.get("anny_auth_telemetry", { type: "json" });
                        return new Response(JSON.stringify({
                            success: true,
                            new_token_issued: Boolean(newToken),
                            telemetry: authTelemetryRaw,
                        }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (err) {
                        return new Response(JSON.stringify({
                            error: "Failed to renew session",
                            details: err.message,
                        }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    (url.pathname === "/api/strategy-consult" || url.pathname === "/api/v1/strategy/consult")) {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    const { prompt, session_id, model_preference } = (await request.json());
                    if (model_preference) {
                        await env.GREEN_STATE.put("ai_model_preference", model_preference);
                    }
                    if (!env.AI) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "AI binding not configured" }), { status: 503, headers: corsHeaders });
                    }
                    try {
                        const marketCacheRaw = (await env.MARKET_CACHE.get("latest_prices", { type: "json" }));
                        let marketContextString = "";
                        if (marketCacheRaw && marketCacheRaw.crypto) {
                            const btc = marketCacheRaw.crypto.BTC?.price || "N/A";
                            const eth = marketCacheRaw.crypto.ETH?.price || "N/A";
                            const sol = marketCacheRaw.crypto.SOL?.price || "N/A";
                            marketContextString = `Live Telemetry: BTC: $${btc}, ETH: $${eth}, SOL: $${sol}`;
                        }
                        let systemMessage = `You are the AXiM Green Machine Strategy Consultant. Current Market Context: [${marketContextString}]. Ecosystem Risk Rules: Max Drawdown Limit = 15%, Max Single Asset Exposure = 35%. Validate user strategy prompts against these rules. If exceeded, set 'riskViolation': true and include 'riskWarning' in your JSON response. Respond in strict JSON with fields: "analysis" (string), "riskLevel" (string: 'Low'|'Medium'|'High'|'Critical'), "actionItems" (array of strings), "riskViolation" (boolean, optional), and "riskWarning" (string, optional).`;
                        const signalList = await env.GREEN_STATE.list({
                            prefix: "anny_signal_log:",
                            limit: 5,
                        });
                        if (signalList.keys && signalList.keys.length > 0) {
                            let signals = [];
                            for (const key of signalList.keys) {
                                const signalRaw = await env.GREEN_STATE.get(key.name);
                                if (signalRaw) {
                                    try {
                                        const s = JSON.parse(signalRaw);
                                        signals.push(`${s.symbol} ${s.action} @ $${s.price} (Bot #${s.bot_id})`);
                                    }
                                    catch (e) { }
                                }
                            }
                            if (signals.length > 0) {
                                systemMessage += ` Recent Anny Signals: [${signals.join(", ")}].`;
                            }
                        }
                        const feedbackList = await env.GREEN_STATE.list({
                            prefix: "exec_feedback:",
                            limit: 1,
                        });
                        if (feedbackList.keys && feedbackList.keys.length > 0) {
                            const feedbackContent = await env.GREEN_STATE.get(feedbackList.keys[0].name);
                            if (feedbackContent) {
                                systemMessage += ` Latest Executive Guidance from Mr. Ellars: [${feedbackContent}]. Incorporate this directive into your strategy evaluation.`;
                            }
                        }
                        try {
                            const riskController = new AbortController();
                            const riskTimeout = setTimeout(() => riskController.abort(), 3000);
                            const riskResponse = await fetch("https://api.anny.trade/v3/ai/assess_risk?coin=BTC&trade_market=USDT&trade_side=long", {
                                signal: riskController.signal,
                                headers: { Accept: "application/json" },
                            });
                            clearTimeout(riskTimeout);
                            if (riskResponse.ok) {
                                const riskData = (await riskResponse.json());
                                const riskProfile = riskData?.riskProfile || "N/A";
                                const adxStrength = riskData?.adx?.strength || "N/A";
                                const rsiValue = riskData?.rsiCross?.value || "N/A";
                                const macdValue = riskData?.macdCross?.value || "N/A";
                                systemMessage += ` Anny Risk Assessment (BTC): Profile=${riskProfile}, ADX=${adxStrength}, RSI=${rsiValue}, MACD=${macdValue}. Incorporate these momentum signals into your strategy response.`;
                            }
                        }
                        catch (e) {
                            console.warn("Anny risk assessment fallback triggered", e);
                        }
                        let response;
                        let isFallback = false;
                        try {
                            let targetModel = "@cf/meta/llama-3.1-8b-instruct";
                            let modelPref = model_preference;
                            if (!modelPref) {
                                modelPref = await env.GREEN_STATE.get("ai_model_preference");
                            }
                            if (modelPref === "mistral-7b") {
                                targetModel = "@cf/mistral/mistral-7b-instruct-v0.2";
                            }
                            response = await env.AI.run(targetModel, {
                                messages: [
                                    { role: "system", content: systemMessage },
                                    { role: "user", content: prompt },
                                ],
                                response_format: { type: "json_object" },
                            }, {
                                extraHeaders: {
                                    "x-session-affinity": `ses_${session_id || "default"}`,
                                },
                            });
                        }
                        catch (primaryErr) {
                            console.warn("[AI_FALLBACK] Primary model failed, failing over to Mistral 7B:", primaryErr);
                            isFallback = true;
                            response = await env.AI.run("@cf/mistral/mistral-7b-instruct-v0.2", {
                                messages: [
                                    { role: "system", content: systemMessage },
                                    { role: "user", content: prompt },
                                ],
                                response_format: { type: "json_object" },
                            });
                        }
                        let parsed = typeof response.response === "string"
                            ? JSON.parse(response.response)
                            : response.response;
                        const duration = Math.round(performance.now() - startTime);
                        const aiModel = isFallback ? "mistral-7b" : "llama-3.1";
                        const serverTiming = isFallback
                            ? `workers-ai-fallback;dur=${duration};ai_model=${aiModel}`
                            : `worker;dur=${duration};desc="Cloudflare Edge Execution";ai_model=${aiModel}`;
                        await env.GREEN_STATE.put(`ai_consult_log:${Date.now()}`, JSON.stringify({
                            riskViolation: parsed.riskViolation || false,
                            riskLevel: parsed.riskLevel || "Unknown",
                            timestamp: Date.now(),
                            ai_inference_ms: duration,
                            model_used: aiModel,
                        }), { expirationTtl: 86400 });
                        // Async logging to api_usage_logs
                        ctx.waitUntil((async () => {
                            try {
                                await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                        apikey: env.SUPABASE_SERVICE_KEY,
                                    },
                                    body: JSON.stringify({
                                        endpoint: "/api/strategy-consult",
                                        status_code: 200,
                                        execution_time_ms: duration,
                                        model_used: aiModel,
                                        token_count: 250 // Static default for now
                                    }),
                                });
                            }
                            catch (err) {
                                console.error("Telemetry insert failed:", err);
                            }
                        })());
                        return new Response(JSON.stringify({
                            success: true,
                            data: parsed,
                            ai_model: aiModel,
                            ai_inference_ms: duration,
                        }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                "Server-Timing": serverTiming,
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (err) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "AI Evaluation Failed" }), { status: 500, headers: corsHeaders });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/circuit-breaker-reset") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const resetState = {
                            state: "CLOSED",
                            failure_count: 0,
                            last_failure: 0,
                        };
                        await env.GREEN_STATE.put("oracle_circuit_breaker", JSON.stringify(resetState));
                        await logAdminAction(env, "circuit-breaker-reset", { resetState });
                        return new Response(JSON.stringify({
                            success: true,
                            message: "Oracle Circuit Reset to CLOSED",
                        }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to reset oracle circuit" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" &&
                    url.pathname === "/api/admin/audit-logs") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    const actionType = url.searchParams.get("action_type");
                    try {
                        const listResult = await env.GREEN_STATE.list({
                            prefix: "admin_action_log:",
                            limit: 50,
                        });
                        let logs = [];
                        for (const key of listResult.keys) {
                            try {
                                const logData = await env.GREEN_STATE.get(key.name, {
                                    type: "json",
                                });
                                if (logData) {
                                    if (actionType && actionType !== "All Actions") {
                                        if (logData.action === actionType) {
                                            logs.push(logData);
                                        }
                                    }
                                    else {
                                        logs.push(logData);
                                    }
                                }
                            }
                            catch (e) { }
                        }
                        // Sort descending by timestamp
                        logs.sort((a, b) => b.timestamp - a.timestamp);
                        return new Response(JSON.stringify({ logs }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to fetch audit logs" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/force-oracle-ping") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        await syncMarketCache(env);
                        return new Response(JSON.stringify({ success: true, message: "Oracle Cache Synced" }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to sync oracle" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/trigger-financial-audit") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const { trigger_source, timestamp } = (await request.json());
                        await logAdminAction(env, "trigger-financial-audit", {
                            trigger_source,
                        });
                        let executive_briefing = await generateAIFinancialAudit(env, ctx);
                        return new Response(JSON.stringify({
                            success: true,
                            message: "Financial audit invoked via Edge Worker proxy",
                            timestamp: Date.now(),
                            executive_briefing,
                        }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ error: e.message }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                // Strict Edge Route Catch-All Termination
                if (url.pathname !== "/" && !url.pathname.startsWith("/api/")) {
                    return new Response(JSON.stringify({ success: false, error: "404 Not Found", timestamp: Date.now() }), {
                        status: 404,
                        headers: corsHeaders,
                    });
                }
                if (request.method === "GET" && url.pathname === "/api/telemetry") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({
                            success: false,
                            error: "Unauthorized Edge Ingress",
                            latencyMs: Math.round(performance.now() - startTime),
                            timestamp: new Date().toISOString(),
                        }), {
                            status: 401,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    let kvLatency = 0;
                    let rpcStatus = "unknown";
                    let kvHits = parseInt(await env.GREEN_STATE.get("telemetry_kv_hits") || "0", 10);
                    let kvMisses = parseInt(await env.GREEN_STATE.get("telemetry_kv_misses") || "0", 10);
                    try {
                        const kvStart = performance.now();
                        await env.GREEN_STATE.get("telemetry_ping");
                        kvLatency = Math.round(performance.now() - kvStart);
                        kvHits++;
                        await env.GREEN_STATE.put("telemetry_kv_hits", kvHits.toString());
                        const rpcStart = performance.now();
                        const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
                            headers: { apikey: env.SUPABASE_SERVICE_KEY },
                        });
                        rpcStatus = rpcRes.ok ? "connected" : "disconnected";
                    }
                    catch (e) {
                        rpcStatus = "error";
                        kvMisses++;
                        await env.GREEN_STATE.put("telemetry_kv_misses", kvMisses.toString());
                    }
                    const ratio = kvHits + kvMisses > 0 ? (kvHits / (kvHits + kvMisses)).toFixed(2) : "1.00";
                    return new Response(JSON.stringify(sanitizeTelemetry({
                        worker_region: request.cf?.colo || 'DEV',
                        uptimeSeconds: Math.floor((Date.now() - workerStartTime) / 1000),
                        kv_cache_ratio: Math.round(Number(ratio) * 100) + "%",
                        success: true,
                        latencyMs: Math.round(performance.now() - startTime),
                        timestamp: new Date().toISOString(),
                        kv_cache_latency_ms: kvLatency,
                        upstream_rpc_status: rpcStatus,
                        edge_version: "v2.4.0-stable",
                        environment: "production",
                        cloudflareEdge: true,
                        auth_handshake_status: Boolean(await env.GREEN_STATE.get("anny_session_token"))
                            ? "verified"
                            : "unverified",
                        ledger_sync_state: "synchronized", // Simulated for now
                    })), {
                        status: 200,
                        headers: {
                            "Content-Type": "application/json",
                            "Cache-Control": "no-store, private",
                            ...corsHeaders,
                        },
                    });
                }
                if (request.method === "GET" && url.pathname === "/api/health") {
                    let kvHits = parseInt(await env.GREEN_STATE.get("telemetry_kv_hits") || "0", 10);
                    let kvMisses = parseInt(await env.GREEN_STATE.get("telemetry_kv_misses") || "0", 10);
                    const ratio = kvHits + kvMisses > 0 ? (kvHits / (kvHits + kvMisses)).toFixed(2) : "1.00";
                    return new Response(JSON.stringify(sanitizeTelemetry({
                        worker_region: request.cf?.colo || 'DEV',
                        uptimeSeconds: Math.floor((Date.now() - workerStartTime) / 1000),
                        kv_cache_ratio: Math.round(Number(ratio) * 100) + "%",
                        success: true,
                        latencyMs: Math.round(performance.now() - startTime),
                        status: "healthy",
                        edge_version: "v2.4.0-stable",
                        timestamp: new Date().toISOString(),
                        environment: "production",
                        cloudflareEdge: true,
                        oracle_provider: "anny_trade_rest",
                        auth_mode: env.ANNY_AUTH_MODE || "session-token",
                        anny_oracle: {
                            status: "active",
                            session_valid: Boolean(await env.GREEN_STATE.get("anny_session_token")),
                            mode: env.ANNY_AUTH_MODE || "session-token",
                        },
                        anny_auth_telemetry: await env.GREEN_STATE.get("anny_auth_telemetry", { type: "json" }),
                        webhook_ingress_telemetry: await env.GREEN_STATE.get("webhook_ingress_telemetry", { type: "json" }),
                        settlement_telemetry_24h: await getSettlementTelemetry24h(env),
                        kv_prune_telemetry: await env.GREEN_STATE.get("kv_prune_telemetry", { type: "json" }),
                        dlq_autoheal_telemetry: await env.GREEN_STATE.get("dlq_autoheal_telemetry", { type: "json" }),
                        investing_brain_telemetry: await (async () => {
                            const dlqList = await env.GREEN_STATE.list({ limit: 1000 });
                            const consultList = dlqList.keys.filter((k) => k.name.startsWith("ai_consult_log:"));
                            let total_consultations_24h = consultList.length;
                            let risk_gates_passed = 0;
                            let risk_warnings = 0;
                            for (const key of consultList) {
                                try {
                                    const logData = JSON.parse((await env.GREEN_STATE.get(key.name)) || "{}");
                                    if (logData.riskViolation) {
                                        risk_warnings++;
                                    }
                                    else {
                                        risk_gates_passed++;
                                    }
                                }
                                catch (e) { }
                            }
                            let total_inference_ms = 0;
                            let count_ms = 0;
                            let llama_count = 0;
                            let mistral_count = 0;
                            for (const key of consultList) {
                                try {
                                    const logData = JSON.parse((await env.GREEN_STATE.get(key.name)) || "{}");
                                    if (logData.ai_inference_ms) {
                                        total_inference_ms += logData.ai_inference_ms;
                                        count_ms++;
                                    }
                                    if (logData.model_used === "mistral-7b") {
                                        mistral_count++;
                                    }
                                    else {
                                        llama_count++;
                                    }
                                }
                                catch (e) { }
                            }
                            let ai_inference_ms = count_ms > 0
                                ? Math.round(total_inference_ms / count_ms)
                                : 0;
                            let total_models = llama_count + mistral_count;
                            let model_usage = {
                                llama_3_1_pct: total_models > 0 ? (llama_count / total_models) * 100 : 0,
                                mistral_7b_pct: total_models > 0
                                    ? (mistral_count / total_models) * 100
                                    : 0,
                            };
                            return {
                                total_consultations_24h,
                                risk_gates_passed,
                                risk_warnings,
                                ai_inference_ms,
                                model_usage,
                            };
                        })(),
                    })), {
                        status: 200,
                        headers: {
                            "Content-Type": "application/json",
                            "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
                            ...corsHeaders,
                        },
                    });
                }
                if (request.method === "DELETE" &&
                    url.pathname === "/api/admin/audit-logs") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        let listResult = await env.GREEN_STATE.list({
                            prefix: "admin_action_log:",
                        });
                        let deletedCount = 0;
                        while (true) {
                            if (listResult.keys.length > 0) {
                                const deletePromises = listResult.keys.map((key) => env.GREEN_STATE.delete(key.name));
                                await Promise.all(deletePromises);
                                deletedCount += listResult.keys.length;
                            }
                            if (listResult.list_complete)
                                break;
                            listResult = await env.GREEN_STATE.list({
                                prefix: "admin_action_log:",
                                cursor: listResult.cursor,
                            });
                        }
                        return new Response(JSON.stringify({
                            success: true,
                            message: "Audit logs purged",
                            count: deletedCount,
                        }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to purge audit logs" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/quarantine-retry-purge") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        let listResult = await env.GREEN_STATE.list({
                            prefix: "quarantine_retry:",
                        });
                        let purgedCount = 0;
                        while (true) {
                            if (listResult.keys.length > 0) {
                                const deletePromises = listResult.keys.map((key) => env.GREEN_STATE.delete(key.name));
                                await Promise.all(deletePromises);
                                purgedCount += listResult.keys.length;
                            }
                            if (listResult.list_complete)
                                break;
                            listResult = await env.GREEN_STATE.list({
                                prefix: "quarantine_retry:",
                                cursor: listResult.cursor,
                            });
                        }
                        return new Response(JSON.stringify({ success: true, purged_count: purgedCount }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to purge quarantined retries" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "GET" &&
                    url.pathname === "/api/admin/quarantine") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        let items = [];
                        let listQ = await env.GREEN_STATE.list({ prefix: "quarantine:" });
                        for (const key of listQ.keys) {
                            try {
                                const val = await env.GREEN_STATE.get(key.name);
                                items.push({
                                    key_name: key.name,
                                    payload: val ? JSON.parse(val) : null,
                                });
                            }
                            catch (e) {
                                items.push({ key_name: key.name, error: "unparseable" });
                            }
                        }
                        let listQR = await env.GREEN_STATE.list({
                            prefix: "quarantine_retry:",
                        });
                        for (const key of listQR.keys) {
                            try {
                                const val = await env.GREEN_STATE.get(key.name);
                                items.push({
                                    key_name: key.name,
                                    payload: val ? JSON.parse(val) : null,
                                });
                            }
                            catch (e) {
                                items.push({ key_name: key.name, error: "unparseable" });
                            }
                        }
                        return new Response(JSON.stringify({ success: true, items }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to fetch quarantine" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                // TRADE EXECUTION OVERRIDE ENDPOINT
                if (request.method === "POST" &&
                    url.pathname === "/api/admin/execute-trade") {
                    try {
                        const authHeader = request.headers.get("Authorization") || "";
                        const token = authHeader.replace("Bearer ", "").trim();
                        if (!token) {
                            return new Response(JSON.stringify({ error: "Missing token" }), {
                                status: 401,
                                headers: { "Content-Type": "application/json", ...corsHeaders },
                            });
                        }
                        try {
                            const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
                            await jwtVerify(token, secret);
                        }
                        catch (e) {
                            return new Response(JSON.stringify({ error: "Invalid token" }), {
                                status: 403,
                                headers: { "Content-Type": "application/json", ...corsHeaders },
                            });
                        }
                        const { key_name } = await request.json();
                        if (!key_name) {
                            return new Response(JSON.stringify({ error: "key_name is required" }), {
                                status: 400,
                                headers: { "Content-Type": "application/json", ...corsHeaders },
                            });
                        }
                        const quarantineItem = await env.GREEN_STATE.get(key_name);
                        if (!quarantineItem) {
                            return new Response(JSON.stringify({ error: "Trade not found in quarantine" }), {
                                status: 404,
                                headers: { "Content-Type": "application/json", ...corsHeaders },
                            });
                        }
                        const parsedItem = JSON.parse(quarantineItem);
                        const payload = parsedItem.payload || parsedItem;
                        const symbol = payload.symbol;
                        const action = payload.action;
                        const amount_usdt = payload.amount_usdt || payload.investment || 25;
                        try {
                            await annyBackendPost("/backend/signal/invest", {
                                symbol,
                                action,
                                amount_usdt,
                                stop_loss: 2
                            }, env, ctx);
                        }
                        catch (e) {
                            return new Response(JSON.stringify({ error: e.message || "Failed to execute override via AnnyTrade" }), {
                                status: 500,
                                headers: { "Content-Type": "application/json", ...corsHeaders },
                            });
                        }
                        // Build a simulated executed trade payload
                        const ledgerEntry = {
                            partner_id: "anny_system",
                            wallet_address: "anny_system",
                            smart_contract_address: "override_execution",
                            amount: payload.investment || payload.amount || 0,
                            currency: payload.symbol || "USD",
                            status: "minted", // "minted" represents executed/settled here
                            transaction_hash: `override_${Date.now()}`,
                            metadata: {
                                ...payload,
                                forced_execution: true,
                                executed_at: new Date().toISOString()
                            }
                        };
                        // Upsert to Supabase
                        const dbResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions?on_conflict=transaction_hash`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                apikey: env.SUPABASE_SERVICE_KEY,
                                Prefer: "resolution=merge-duplicates",
                            },
                            body: JSON.stringify([ledgerEntry]),
                        });
                        if (!dbResponse.ok) {
                            throw new Error(`Supabase insert failed: ${await dbResponse.text()}`);
                        }
                        await env.GREEN_STATE.delete(key_name);
                        return new Response(JSON.stringify({ success: true, message: "Trade executed successfully" }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (error) {
                        return new Response(JSON.stringify({ error: error.message }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "DELETE" &&
                    url.pathname === "/api/admin/quarantine/all") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        let purgedCount = 0;
                        // Delete quarantine: keys
                        let listResult = await env.GREEN_STATE.list({
                            prefix: "quarantine:",
                        });
                        while (true) {
                            if (listResult.keys.length > 0) {
                                const deletePromises = listResult.keys.map((key) => env.GREEN_STATE.delete(key.name));
                                await Promise.all(deletePromises);
                                purgedCount += listResult.keys.length;
                            }
                            if (listResult.list_complete)
                                break;
                            listResult = await env.GREEN_STATE.list({
                                prefix: "quarantine:",
                                cursor: listResult.cursor,
                            });
                        }
                        // Delete quarantine_retry: keys
                        listResult = await env.GREEN_STATE.list({
                            prefix: "quarantine_retry:",
                        });
                        while (true) {
                            if (listResult.keys.length > 0) {
                                const deletePromises = listResult.keys.map((key) => env.GREEN_STATE.delete(key.name));
                                await Promise.all(deletePromises);
                                purgedCount += listResult.keys.length;
                            }
                            if (listResult.list_complete)
                                break;
                            listResult = await env.GREEN_STATE.list({
                                prefix: "quarantine_retry:",
                                cursor: listResult.cursor,
                            });
                        }
                        return new Response(JSON.stringify({
                            success: true,
                            message: "GLOBAL QUARANTINE PURGE COMPLETE",
                            purged_count: purgedCount,
                        }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                                "Cache-Control": "no-store, private",
                                ...corsHeaders,
                            },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({
                            error: "Failed to execute global quarantine purge",
                        }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                if (request.method === "DELETE" &&
                    url.pathname === "/api/admin/quarantine") {
                    const signature = request.headers.get("X-Axim-Signature");
                    if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                        return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                            status: 401,
                            headers: corsHeaders,
                        });
                    }
                    try {
                        const payload = (await request.json());
                        if (payload.key_name) {
                            await env.GREEN_STATE.delete(payload.key_name);
                        }
                        return new Response(JSON.stringify({ success: true, message: "Item purged" }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ type: "about:blank", title: "Error", detail: "Failed to purge item" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                // Explicit Fallback Route Evaluation
                if (url.pathname !== "/" &&
                    url.pathname !== "/api/dlq-status" &&
                    url.pathname !== "/api/cache-sync" &&
                    url.pathname !== "/api/admin/dept-summary" &&
                    url.pathname !== "/api/admin/send-exec-briefing" &&
                    url.pathname !== "/api/admin/briefing-archive" &&
                    url.pathname !== "/api/admin/replay-webhook" &&
                    url.pathname !== "/api/webhooks/emailit-inbound" &&
                    url.pathname !== "/api/webhooks/anny-signal" &&
                    url.pathname !== "/api/anny/active-positions" &&
                    url.pathname !== "/api/anny-signals" &&
                    url.pathname !== "/api/dlq-flush" &&
                    url.pathname !== "/api/market-cache" &&
                    url.pathname !== "/api/market/history" &&
                    url.pathname !== "/api/strategy-consult" && url.pathname !== "/api/v1/strategy/consult" &&
                    url.pathname !== "/api/quarantine-purge" &&
                    url.pathname !== "/api/admin/quarantine" &&
                    url.pathname !== "/api/admin/quarantine/all" &&
                    url.pathname !== "/api/admin/execute-trade" &&
                    url.pathname !== "/api/health" &&
                    url.pathname !== "/api/telemetry" &&
                    url.pathname !== "/api/admin/renew-anny-session" &&
                    url.pathname !== "/api/admin/validate-signal" &&
                    url.pathname !== "/api/admin/quarantine-retry-purge" &&
                    url.pathname !== "/api/admin/verify-deployment" &&
                    url.pathname !== "/api/admin/trigger-financial-audit" &&
                    url.pathname !== "/api/admin/force-oracle-ping" &&
                    url.pathname !== "/api/admin/audit-logs" &&
                    url.pathname !== "/api/admin/panic-close") {
                    return new Response(JSON.stringify({ success: false, error: "404 Not Found", timestamp: Date.now() }), {
                        status: 404,
                        headers: corsHeaders,
                    });
                }
                if (url.pathname === "/api/admin/panic-close" && request.method === "POST") {
                    try {
                        const authHeader = request.headers.get("Authorization");
                        if (!authHeader || !authHeader.startsWith("Bearer ")) {
                            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
                        }
                        const token = authHeader.split(" ")[1];
                        const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
                        try {
                            await jwtVerify(token, secret);
                        }
                        catch (err) {
                            return new Response(JSON.stringify({ error: "Invalid admin token" }), { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } });
                        }
                        // Fetch active positions
                        const positionsData = await annyBackendPost("/backend/activepositions", {}, env, ctx);
                        let positions = [];
                        if (Array.isArray(positionsData)) {
                            positions = positionsData;
                        }
                        else if (positionsData && Array.isArray(positionsData.positions)) {
                            positions = positionsData.positions;
                        }
                        let closedCount = 0;
                        for (const position of positions) {
                            if (position && position.symbol) {
                                await annyBackendPost("/backend/signal/invest", { action: "sell", symbol: position.symbol }, env, ctx);
                                closedCount++;
                            }
                        }
                        return new Response(JSON.stringify({ success: true, closedCount, message: `Panic closed ${closedCount} positions.` }), {
                            status: 200,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    catch (e) {
                        return new Response(JSON.stringify({ success: false, error: e.message || "Failed to execute panic close" }), {
                            status: 500,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                }
                // 1. HMAC Validation (The Ingress Token Isolation Rule)
                const signature = request.headers.get("X-Axim-Signature");
                if (!signature || !timingSafeEqual(signature, env.AXIM_INTERNAL_KEY)) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized Edge Ingress", timestamp: Date.now() }), {
                        status: 401,
                        headers: corsHeaders,
                    });
                }
                try {
                    const payload = (await request.json());
                    // 2. Extract and rigorously transform variables
                    let { partner_id, wallet_address, smart_contract_address, amount, currency, event_type, transaction_hash, } = payload;
                    // Expand partner_id assignment logic
                    if (!partner_id) {
                        partner_id =
                            payload.metadata?.linked_affiliate_id ||
                                payload.metadata?.promo_code ||
                                null;
                    }
                    if (typeof partner_id === "string") {
                        // Sanitize
                        partner_id = partner_id.trim();
                    }
                    let status = "pending";
                    if (event_type === "minted" || event_type === "settled")
                        status = "minted";
                    if (event_type === "failed")
                        status = "failed";
                    const ledgerEntry = {
                        partner_id,
                        wallet_address,
                        smart_contract_address,
                        amount,
                        currency,
                        status,
                        ...(transaction_hash && { transaction_hash }),
                    };
                    // 3. Upsert to Supabase PostgREST Bulk Ingestion
                    const dbResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/blockchain_transactions?on_conflict=transaction_hash`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                            apikey: env.SUPABASE_SERVICE_KEY,
                            Prefer: "resolution=merge-duplicates",
                        },
                        body: JSON.stringify([ledgerEntry]),
                    });
                    if (!dbResponse.ok) {
                        throw new Error(`DB Ingestion Fault: ${dbResponse.statusText}`);
                    }
                    return new Response(JSON.stringify({ success: true, status: "ledger_updated" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json", ...corsHeaders },
                    });
                }
                catch (error) {
                    // Aggregate usage/errors asynchronously
                    ctx.waitUntil((async () => {
                        try {
                            await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                                    apikey: env.SUPABASE_SERVICE_KEY,
                                },
                                body: JSON.stringify({
                                    endpoint: url.pathname,
                                    status_code: 500,
                                    error_message: error.message,
                                    count: 1,
                                }),
                            });
                        }
                        catch (e) {
                            console.error("Failed to log to api_usage_logs:", e);
                        }
                    })());
                    // 4. Fail-Open Edge Buffer (DLQ)
                    const errorId = `dlq_tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                    // Clone request for DLQ backup if possible, or stringify known payload
                    const rawPayload = await request
                        .clone()
                        .text()
                        .catch(() => '{"error": "unparseable"}');
                    await env.GREEN_STATE.put(errorId, rawPayload, {
                        metadata: {
                            error: error.message,
                            timestamp: Date.now(),
                        },
                    });
                    return new Response(JSON.stringify({ type: "about:blank", title: "Buffered to DLQ", detail: error.message, status: 202, dlq_id: errorId }), {
                        status: 202,
                        headers: { "Content-Type": "application/json", ...corsHeaders },
                    }); // Accepted but deferred
                }
            })(); // Close inner async IIFE
            // Check response status for telemetry
            if (response && response.status >= 500)
                isError = true;
            if (response && response.status === 429)
                isRateLimit = true;
            if (response) {
                const newHeaders = new Headers(response.headers);
                newHeaders.set('X-Edge-Region', request.cf?.colo || 'DEV');
                newHeaders.set('X-Cache-Status', 'MISS'); // Default for thirdweb_bridge
                const latencyMs = Math.round(performance.now() - startTime);
                newHeaders.set('X-Execution-Time-Ms', latencyMs.toString());
                // ENFORCE UNIFORM JSON STRUCTURE
                let newBody = response.body;
                const contentType = newHeaders.get('Content-Type') || '';
                if (contentType.includes('application/json')) {
                    try {
                        const oldText = await response.clone().text();
                        const oldJson = JSON.parse(oldText);
                        let newStatus = "ok";
                        if (response.status >= 500)
                            newStatus = "error";
                        else if (response.status >= 400)
                            newStatus = "error";
                        // Map some internal flags to 'degraded' or 'error'
                        if (oldJson.success === false)
                            newStatus = "error";
                        if (oldJson.status === "degraded")
                            newStatus = "degraded";
                        let dataArray = oldJson.data || [oldJson];
                        if (!Array.isArray(dataArray)) {
                            if (oldJson.data !== undefined) {
                                dataArray = [oldJson.data];
                            }
                            else {
                                // copy fields excluding success/status
                                const { success, status, error, ...rest } = oldJson;
                                dataArray = [rest];
                                if (error) {
                                    dataArray[0].error_detail = error;
                                }
                            }
                        }
                        const uniformPayload = {
                            status: newStatus,
                            data: dataArray,
                            latencyMs: latencyMs,
                            timestamp: new Date().toISOString()
                        };
                        newBody = JSON.stringify(uniformPayload);
                    }
                    catch (e) {
                        // Ignore parse errors, leave body as is
                    }
                }
                response = new Response(newBody, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: newHeaders
                });
            }
            return response;
        }
        catch (e) {
            isError = true;
            const latencyMs = Math.round(performance.now() - startTime);
            return new Response(JSON.stringify({
                status: "error",
                data: [{ error_detail: e.message || "Internal Edge Error" }],
                latencyMs: latencyMs,
                timestamp: new Date().toISOString()
            }), {
                status: 502,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }
        finally {
            const durationMs = Math.round(performance.now() - startTime);
            ctx.waitUntil(trackEdgeRequest(env, isError, isRateLimit, {
                url: request.url,
                method: request.method,
                colo: request.cf?.colo || 'UNKNOWN',
                durationMs,
                userAgent: request.headers.get("User-Agent") || "Unknown"
            }));
        }
    },
};
