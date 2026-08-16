const fs = require('fs');

const path = 'edge-ledger-worker/src/thirdweb_bridge.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
`                uptimeSeconds: Math.floor((Date.now() - workerStartTime) / 1000),
                kv_cache_ratio: ratio,`,
`                uptimeSeconds: Math.floor((Date.now() - workerStartTime) / 1000),
                kv_cache_ratio: Math.round(Number(ratio) * 100) + "%",`);

fs.writeFileSync(path, content, 'utf8');
