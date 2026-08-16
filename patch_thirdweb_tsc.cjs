const fs = require('fs');

const path = 'edge-ledger-worker/src/thirdweb_bridge.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
`                timestamp: new Date().toISOString(),
                uptimeSeconds:
                  0,`,
`                timestamp: new Date().toISOString(),`);

fs.writeFileSync(path, content, 'utf8');
