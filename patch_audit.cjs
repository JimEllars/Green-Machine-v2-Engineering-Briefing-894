const fs = require('fs');
let content = fs.readFileSync('edge-ledger-worker/src/thirdweb_bridge.ts', 'utf8');

const search = `    if (request.method === 'POST' && url.pathname === '/api/admin/quarantine-retry-purge') {`;

const replace = `    if (request.method === 'DELETE' && url.pathname === '/api/admin/audit-logs') {
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

    if (request.method === 'POST' && url.pathname === '/api/admin/quarantine-retry-purge') {`;

if (content.includes(search)) {
    content = content.replace(search, replace);
    fs.writeFileSync('edge-ledger-worker/src/thirdweb_bridge.ts', content);
    console.log("Patched route");
} else {
    console.log("Not found route");
}
