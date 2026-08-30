// Briefing Generator module for executive daily briefings
export async function sendViaResend(params, env, reason) {
    const RESEND_API_KEY = env.RESEND_API_KEY || "TEST_RESEND_KEY";
    const endpoint = "https://api.resend.com/emails";
    console.log(`Failing over to Resend. Reason: ${reason}`);
    const payload = {
        from: "noreply@axim.us.com",
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
        html: params.html,
    };
    if (params.cc) {
        payload.cc = Array.isArray(params.cc) ? params.cc : [params.cc];
    }
    if (params.meta) {
        payload.tags = Object.entries(params.meta).map(([name, value]) => ({ name, value }));
    }
    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify(payload),
        });
        if (response.ok) {
            return { success: true, error: undefined };
        }
        const errorBody = await response.text();
        return { success: false, error: `Resend returned ${response.status} ${response.statusText}: ${errorBody}` };
    }
    catch (e) {
        return { success: false, error: e.message };
    }
}
export async function sendEmailItNotification(params, env, ctx) {
    // Check circuit breaker and daily limits in KV
    try {
        const circuitBreakerStr = await env.GREEN_STATE.get("emailit_circuit_breaker");
        if (circuitBreakerStr) {
            return await sendViaResend(params, env, "Circuit breaker active for EmailIt");
        }
        const dailyRemainingStr = await env.GREEN_STATE.get("emailit_daily_remaining");
        if (dailyRemainingStr !== null && parseInt(dailyRemainingStr, 10) <= 0) {
            return await sendViaResend(params, env, "EmailIt daily sending quota exhausted");
        }
    }
    catch (e) {
        console.error("Failed to read circuit breaker state from KV", e);
    }
    const EMAILIT_API_KEY = env.EMAILIT_API_KEY || "TEST_KEY";
    const endpoint = "https://api.emailit.com/v2/emails";
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);
            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${EMAILIT_API_KEY}`,
                },
                body: JSON.stringify({
                    to: params.to,
                    cc: params.cc,
                    subject: params.subject,
                    html: params.html,
                    from: "noreply@axim.us.com",
                }),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            // Inspect response headers
            const remaining = response.headers.get("ratelimit-daily-remaining");
            if (remaining !== null) {
                const putPromise = env.GREEN_STATE.put("emailit_daily_remaining", remaining);
                if (ctx && ctx.waitUntil) {
                    ctx.waitUntil(putPromise);
                }
                else {
                    await putPromise;
                }
            }
            if (response.ok) {
                return { success: true, error: undefined };
            }
            // Failover triggers
            if (response.status === 429 || response.status === 403 || response.status >= 500) {
                const putCircuit = env.GREEN_STATE.put("emailit_circuit_breaker", "open", { expirationTtl: 300 });
                if (ctx && ctx.waitUntil) {
                    ctx.waitUntil(putCircuit);
                }
                else {
                    await putCircuit;
                }
                return await sendViaResend(params, env, `EmailIt returned HTTP ${response.status}`);
            }
            lastError = new Error(`EmailIt returned ${response.status} ${response.statusText}`);
        }
        catch (e) {
            if (e.name === 'AbortError' || e.message.includes('timeout') || e.message.includes('network')) {
                const putCircuit = env.GREEN_STATE.put("emailit_circuit_breaker", "open", { expirationTtl: 300 });
                if (ctx && ctx.waitUntil) {
                    ctx.waitUntil(putCircuit);
                }
                else {
                    await putCircuit;
                }
                return await sendViaResend(params, env, "EmailIt connection timeout");
            }
            lastError = e;
            await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
    }
    return { success: false, error: lastError?.message || "Unknown error" };
}
export async function dispatchExecutiveBriefing(env, ctx, auditSummaryText = "AI Financial Audit unavailable.") {
    try {
        const cacheResult = await env.MARKET_CACHE.getWithMetadata("latest_prices");
        // Fetch live API usage summary
        let totalTokens = "N/A";
        try {
            const summaryResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_summary?select=total_tokens&limit=1`, {
                headers: {
                    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
                },
            });
            if (summaryResponse.ok) {
                const summaryData = await summaryResponse.json();
                if (Array.isArray(summaryData) && summaryData.length > 0) {
                    totalTokens = summaryData[0].total_tokens ?? "N/A";
                }
            }
        }
        catch (e) {
            console.error("Failed to fetch api_usage_summary", e);
        }
        let btc = "N/A", eth = "N/A", sol = "N/A";
        if (cacheResult?.value) {
            try {
                const parsedCache = typeof cacheResult.value === "string"
                    ? JSON.parse(cacheResult.value)
                    : cacheResult.value;
                if (parsedCache?.crypto) {
                    btc = `$${parsedCache.crypto.BTC?.price || "N/A"}`;
                    eth = `$${parsedCache.crypto.ETH?.price || "N/A"}`;
                    sol = `$${parsedCache.crypto.SOL?.price || "N/A"}`;
                }
            }
            catch (e) {
                console.error("Failed to parse market cache for briefing", e);
            }
        }
        // System Telemetry Counts
        const dlqList = await env.GREEN_STATE.list({ prefix: "dlq:" });
        const bufferedCount = dlqList.keys?.length || 0;
        const quarantineList = await env.GREEN_STATE.list({
            prefix: "quarantine:",
        });
        const quarantinedCount = quarantineList.keys?.length || 0;
        // Fetch latest Anny signals
        const annyList = await env.GREEN_STATE.list({
            prefix: "anny_signal_log:",
            limit: 5,
        });
        let signalSummaryHtml = "<p>No recent signals recorded.</p>";
        if (annyList.keys && annyList.keys.length > 0) {
            signalSummaryHtml = "<ul>";
            for (const key of annyList.keys) {
                const signalDataStr = await env.GREEN_STATE.get(key.name);
                if (signalDataStr) {
                    try {
                        const signalData = JSON.parse(signalDataStr);
                        const ts = new Date(parseInt(key.name.split(":")[1]) || Date.now()).toLocaleString();
                        signalSummaryHtml += `<li><b>${ts}</b>: ${signalData.symbol} ${signalData.action} (Bot ID: ${signalData.bot_id}) - ${signalData.investment} investment.</li>`;
                    }
                    catch (e) {
                        // Ignore parse errors for individual signals
                    }
                }
            }
            signalSummaryHtml += "</ul>";
        }
        // Fetch department progress summaries
        const deptList = await env.GREEN_STATE.list({
            prefix: "department_progress:",
            limit: 10,
        });
        let deptSummariesHtml = "<p>No recent department reports recorded.</p>";
        if (deptList.keys && deptList.keys.length > 0) {
            deptSummariesHtml = "<ul>";
            for (const key of deptList.keys) {
                const reportDataStr = await env.GREEN_STATE.get(key.name);
                if (reportDataStr) {
                    try {
                        const report = JSON.parse(reportDataStr);
                        const ts = new Date(report.timestamp).toLocaleString();
                        deptSummariesHtml += `<li><b>${report.department} (${ts}):</b> ${report.summary} [Metrics: ${JSON.stringify(report.metrics)}]</li>`;
                    }
                    catch (e) { }
                }
            }
            deptSummariesHtml += "</ul>";
        }
        let portfolioSummaryHtml = "<p>Portfolio data unavailable</p>";
        try {
            const portResp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_combined_portfolio`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
                    "Content-Type": "application/json",
                },
            });
            if (portResp.ok) {
                const pData = await portResp.json();
                if (pData && pData.length > 0 && pData[0].combined_portfolio) {
                    const cp = pData[0].combined_portfolio;
                    portfolioSummaryHtml = `<p><b>Total Balance:</b> $${cp.total_balance_usd}</p><ul>`;
                    if (cp.assets) {
                        for (const [k, v] of Object.entries(cp.assets)) {
                            portfolioSummaryHtml += `<li>${k}: ${v.amount} ($${v.usd_value})</li>`;
                        }
                    }
                    portfolioSummaryHtml += "</ul>";
                }
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
      <h3>AI Financial Audit & Token Efficiency</h3>
      <p>${auditSummaryText}</p>
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
        <li>Total API Tokens Used: ${totalTokens}</li>
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
        }, env, ctx);
        if (dispatchResult.success) {
            await env.GREEN_STATE.put(`briefing_log:${Date.now()}`, "Dispatched successfully", { expirationTtl: 86400 });
        }
    }
    catch (err) {
        console.error("Error generating executive briefing", err);
        await env.GREEN_STATE.put(`briefing_log:${Date.now()}`, `Failed: ${err.message}`, { expirationTtl: 86400 });
        try {
            // Buffer failure for retry logic queue
            await env.GREEN_STATE.put(`email_retry_queue:${Date.now()}`, JSON.stringify({
                to: "james.ellars@axim.us.com",
                cc: ["jrellars@gmail.com"],
                subject: "AXiM Executive Briefing (Delayed)",
                html: "<p>The automated briefing encountered an error. A retry will be attempted shortly.</p>",
            }), { expirationTtl: 86400 });
        }
        catch (e) {
            console.error("Failed to write to retry queue", e);
        }
    }
}
