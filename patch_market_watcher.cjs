const fs = require('fs');
const file = 'edge-ledger-worker/src/market_watcher.ts';
let content = fs.readFileSync(file, 'utf8');

// We need to add env to fetchHealth and record telemetry
content = content.replace(/export async function fetchHealth\(env: Env, request: Request, ctx: ExecutionContext\): Promise<Response> \{/, `export async function fetchHealth(env: Env, request: Request, ctx: ExecutionContext): Promise<Response> {
  ctx.waitUntil((async () => {
    try {
      if ((env as any).SUPABASE_URL && (env as any).SUPABASE_SERVICE_KEY) {
        await fetch(\`\${(env as any).SUPABASE_URL}/rest/v1/api_usage_logs\`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: \`Bearer \${(env as any).SUPABASE_SERVICE_KEY}\`,
            apikey: (env as any).SUPABASE_SERVICE_KEY,
          },
          body: JSON.stringify({
            endpoint: "/api/health",
            status_code: 200,
            error_message: null,
            count: 1,
          }),
        });
      }
    } catch (e) {
      console.error("Failed to log to api_usage_logs from health check:", e);
    }
  })());
`);

fs.writeFileSync(file, content);
