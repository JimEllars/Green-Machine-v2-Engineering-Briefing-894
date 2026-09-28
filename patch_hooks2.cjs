const fs = require('fs');

const path = 'src/hooks/useSystemDiagnostics.js';
let code = fs.readFileSync(path, 'utf8');

// Ensure useRef is imported
code = code.replace(
  "import { useState, useEffect, useCallback, useTransition } from 'react';",
  "import { useState, useEffect, useCallback, useTransition, useRef } from 'react';"
);

// We need to inject the new functionality inside `useSystemDiagnostics`.
const startTag = "export const useSystemDiagnostics = (isAuthenticated = true) => {";

const injection = `
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorLocal, setErrorLocal] = useState(null);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const lastKnownGood = useRef(null);

  const fetchDiagnosticsNew = useCallback(async () => {
    setIsLiveSyncing(true);
    try {
      const baseUrl = getWorkerUrl();
      const response = await fetch(\`\${baseUrl}/diagnostics\`, {
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(\`Worker diagnostics returned status: \${response.status}\`);
      }

      const json = await response.json();
      lastKnownGood.current = json;
      setData(json);
      setErrorLocal(null);
    } catch (err) {
      console.warn('Diagnostics telemetry warning:', err.message);
      setErrorLocal(err.message);
      // Retain last known metrics so UI remains functional
      if (lastKnownGood.current) {
        setData(lastKnownGood.current);
      }
    } finally {
      setLoading(false);
      setIsLiveSyncing(false);
    }
  }, []);

  useEffect(() => {
    fetchDiagnosticsNew();
    const interval = setInterval(fetchDiagnosticsNew, 15000); // adaptive interval handling might be inside the new panel or just default 15s here
    return () => clearInterval(interval);
  }, [fetchDiagnosticsNew]);
`;

code = code.replace(startTag, startTag + "\n" + injection);

const endReturnTagStr = `  return { telemetry, telemetryHistory, latencyMs, status, isFetching, refetch: fetchDiagnostics, computeDebt, emailServiceStatus, triggerTestEmail, emailService, verifyEmailDelivery };`;
const endReturnReplacementStr = `  return {
    telemetry, telemetryHistory, latencyMs, status, isFetching, refetch: fetchDiagnostics,
    computeDebt, emailServiceStatus, triggerTestEmail, emailService, verifyEmailDelivery,
    diagnostics: data,
    diagnosticsLoading: loading,
    diagnosticsError: errorLocal,
    isLiveSyncing,
    refreshDiagnostics: fetchDiagnosticsNew
  };`;

code = code.replace(endReturnTagStr, endReturnReplacementStr);

fs.writeFileSync(path, code);
console.log("Hook patched successfully");
