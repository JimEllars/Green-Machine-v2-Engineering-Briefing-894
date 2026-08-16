const fs = require('fs');

const path = 'edge-ledger-worker/src/thirdweb_bridge.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
`                kv_cache_ratio: Math.round(Number(ratio) * 100) + "%",
                kv_cache_ratio: ratio,`,
`                kv_cache_ratio: Math.round(Number(ratio) * 100) + "%",`);

fs.writeFileSync(path, content, 'utf8');
