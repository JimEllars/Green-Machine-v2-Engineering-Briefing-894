const fs = require('fs');

const path = 'src/hooks/useSystemDiagnostics.js';
let content = fs.readFileSync(path, 'utf8');

// Add import
content = content.replace("import { supabase } from '../supabaseClient';", "import { supabase } from '../supabaseClient';\nimport { getWorkerUrl } from '../utils/workerUrl';");

// Replace workerUrl variable declaration
content = content.replace("const workerUrl = import.meta.env.VITE_WORKER_URL || 'https://green-machine-edge-ledger.jrellars.workers.dev';", "const workerUrl = getWorkerUrl();");

fs.writeFileSync(path, content, 'utf8');
