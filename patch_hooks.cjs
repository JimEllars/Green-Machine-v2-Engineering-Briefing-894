const fs = require('fs');

let content = fs.readFileSync('src/hooks/useSystemDiagnostics.js', 'utf8');

// Modify the hook to accept authState and only fetch if authenticated
content = content.replace(
  'export const useSystemDiagnostics = () => {',
  `import { getSessionState } from '../supabaseClient';\nexport const useSystemDiagnostics = (isAuthenticated = true) => {`
);

content = content.replace(
  `const runFetch = async () => {`,
  `const runFetch = async () => {\n      if (!isAuthenticated) return;\n`
);

content = content.replace(
  `const channel = supabase.channel('telemetry_stream')`,
  `if (!isAuthenticated) return;\n\n    const channel = supabase.channel('telemetry_stream')`
);

fs.writeFileSync('src/hooks/useSystemDiagnostics.js', content, 'utf8');
console.log('useSystemDiagnostics.js patched successfully');
