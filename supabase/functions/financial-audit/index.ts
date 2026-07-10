/**
 * Target: Supabase Edge Function
 * Role: financial-audit/index.ts
 * Description: Intercepts pg_cron trigger, compiles system state, and routes to LLM Proxy.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
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
    // 2. Scrape System Variables (Mocked queries for blueprint)
    // a. Compute debts from api_usage_logs
    const { data: usageLogs } = await supabase.from('api_usage_logs').select('*').limit(100);
    
    // b. Active affiliate records
    const { data: affiliates } = await supabase.from('blockchain_transactions').select('*').eq('status', 'minted');

    // c. Fetch Market Cache (Simulated external KV read via API)
    const marketCache = { BTC: 64000, ETH: 3400 }; 

    // 3. Channel to LLM Proxy (DeepSeek Priority)
    const systemContext = {
      usage_debts: usageLogs?.length || 0,
      recent_minted_payouts: affiliates?.length || 0,
      market_state: marketCache
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

    // 4. Write to Ledger & Trigger Realtime
    await supabase.from('financial_recommendations').insert({
      provider_used: provider,
      strategy_payload: recommendation.output,
      created_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({ success: true, routed_to: provider }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
})