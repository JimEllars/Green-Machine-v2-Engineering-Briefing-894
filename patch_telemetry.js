const fs = require('fs');
let code = fs.readFileSync('src/hooks/useSystemDiagnostics.js', 'utf8');

code = code.replace(
  `        localTelemetry = data;
        setTelemetry(data);`,
  `        // Check if the response follows the standardized { status, data, ... } wrapper
        if (data && data.status && Array.isArray(data.data) && data.data.length > 0) {
          localTelemetry = data.data[0];
          setTelemetry(data.data[0]);
        } else {
          // Fallback for non-standardized or legacy payload
          localTelemetry = data;
          setTelemetry(data);
        }`
);

fs.writeFileSync('src/hooks/useSystemDiagnostics.js', code);
console.log('patched');
