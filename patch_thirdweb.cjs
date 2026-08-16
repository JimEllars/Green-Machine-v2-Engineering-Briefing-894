const fs = require('fs');

const path = 'edge-ledger-worker/src/thirdweb_bridge.ts';
let content = fs.readFileSync(path, 'utf8');

// Remove duplicate line
content = content.replace('url.pathname !== "/api/telemetry" &&\n          url.pathname !== "/api/telemetry" &&', 'url.pathname !== "/api/telemetry" &&');

fs.writeFileSync(path, content, 'utf8');
