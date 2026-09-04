import re

with open("edge-ledger-worker/src/thirdweb_bridge.ts", "r") as f:
    content = f.read()

replacement = """
            const payload = (await request.json()) as any;

            // Check Volatility Circuit Breaker
            const isBreakerActive = await env.GREEN_STATE.get("CIRCUIT_BREAKER_ACTIVE");
            if (isBreakerActive === "true" && !payload.override_circuit_breaker) {
               return new Response(JSON.stringify({
                  success: false,
                  status: "CIRCUIT_BREAKER_ACTIVE",
                  error: "Treasury execution halted due to extreme market volatility. Awaiting manual override."
               }), {
                  status: 403,
                  headers: { "Content-Type": "application/json", ...corsHeaders }
               });
            }

            const payouts = payload.payouts || [];
"""

content = content.replace("""
            const payload = (await request.json()) as any;
            const payouts = payload.payouts || [];
""", replacement)

content = content.replace("await syncMarketCache(env);", "await syncMarketCache(env, ctx);")

with open("edge-ledger-worker/src/thirdweb_bridge.ts", "w") as f:
    f.write(content)
