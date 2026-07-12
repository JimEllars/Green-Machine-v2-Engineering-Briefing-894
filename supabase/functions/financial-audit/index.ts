/**
 * Target: Supabase Edge Function
 * Role: financial-audit/index.ts
 * Description: Intercepts pg_cron trigger, compiles system state, and routes to LLM Proxy.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req: Request) => {
  // 1. Strict RBAC / Header Validation
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string)) {
    return new Response('Unauthorized Access', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  try {
    // 2. Scrape System Variables (Exact count structures for blueprint)
    // a. Compute debts from api_usage_logs
    const { data: aggregatedDebt } = await supabase.from('api_usage_summary').select('*').single();
    
    // b. Active affiliate records
    const { count: affiliatesCount } = await supabase.from('blockchain_transactions').select('*', { count: 'exact', head: true }).eq('status', 'minted');

    // c. Fetch Market Cache (Live external KV read via API)
    let marketCache = { BTC: 0, ETH: 0 }; // Fallback
    try {
      const workerUrl = Deno.env.get('WORKER_URL');
      if (workerUrl) {
        const cacheResponse = await fetch(`${workerUrl}/api/market-cache`, {
          headers: {
            'X-Axim-Signature': Deno.env.get('AXIM_INTERNAL_KEY') || ''
          }
        });
        if (cacheResponse.ok) {
          const liveData = await cacheResponse.json();
          if (liveData?.crypto?.BTC?.price && liveData?.crypto?.ETH?.price) {
             marketCache = {
                BTC: liveData.crypto.BTC.price,
                ETH: liveData.crypto.ETH.price
             };
          }
        }
      }
    } catch(e) {
      console.error("Failed to fetch live market cache:", e);
    }

    // Calculate Node Health Index (H = 0.7 * M - 0.3 * D)
    const M = affiliatesCount || 0; // Marginal proxy

    // Extract fine-grained sums
    const totalTokens = aggregatedDebt?.total_tokens || 0;
    const totalExecutionTime = aggregatedDebt?.total_execution_time_ms || 0;

    // Keep D as a proxy for the formula using sum values (adjusting magnitude for the same formula, or using tokens/time as proxy)
    // Since instructions say "Map these fine-grained compute numbers directly into the context configurations", we will add them to systemContext.
    // We will keep D as a generalized debt scalar from the new fine-grained data, or just use the raw sums. Let's use totalTokens / 100 + totalExecutionTime / 1000 for D if we need a number, but we can also just compute it. The requirements say:
    // "Map these fine-grained compute numbers directly into the context configurations funneled to the central llm-proxy."
    const D = totalTokens; // Debt proxy updated to token sums instead of row counts for the index
    const nodeHealthIndex = (0.7 * M) - (0.3 * D);

    // 3. Channel to LLM Proxy (DeepSeek Priority)
    const systemContext = {
      usage_debts: {
        total_tokens: totalTokens,
        total_execution_time_ms: totalExecutionTime
      },
      recent_minted_payouts: M,
      market_state: marketCache,
      node_health_index: nodeHealthIndex
    };

    // Determine if macro reallocation is needed (Complex reasoning -> Claude)
    const needsDeepReasoning = marketCache.BTC < 60000; // Arbitrary volatility trigger
    const provider = needsDeepReasoning ? 'anthropic' : 'deepseek';

    const llmProxyResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/llm-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({
        provider,
        prompt: `Analyze the following telemetry and provide fiscal suggestions: ${JSON.stringify(systemContext)}`
      })
    });

    const recommendation = await llmProxyResponse.json();

    // Try to parse the recommendation output as JSON to append the optimized value
    let strategyPayload = recommendation.output;
    try {
      let cleanedPayload = strategyPayload;
      if (typeof cleanedPayload === 'string') {
        // Strip out markdown blocks (```json, ```, etc.)
        cleanedPayload = cleanedPayload.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
      }
      const parsedOut = JSON.parse(cleanedPayload);
      parsedOut._node_health_index = nodeHealthIndex;
      strategyPayload = JSON.stringify(parsedOut, null, 2);
    } catch(e) {
      // If it's not JSON, append it textually or ignore
      strategyPayload = JSON.stringify({
        schema_fallback: true,
        raw_message: strategyPayload,
        _node_health_index: nodeHealthIndex
      }, null, 2);
    }

    // 4. Write to Ledger & Trigger Realtime
    await supabase.from('financial_recommendations').insert({
      provider_used: provider,
      strategy_payload: strategyPayload,
      created_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({ success: true, routed_to: provider }), { status: 200 });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
})
