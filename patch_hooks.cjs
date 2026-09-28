const fs = require('fs');

const path = 'src/hooks/useSystemDiagnostics.js';
let code = fs.readFileSync(path, 'utf8');

// Replace the top portion of the hook to introduce new state and updated fetchDiagnostics
const startTag = "export function useSystemDiagnostics(pollInterval = 10000) {";

const replacementStr = `export function useSystemDiagnostics(pollInterval = 15000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
      setError(null);
    } catch (err) {
      console.warn('Diagnostics telemetry warning:', err.message);
      setError(err.message);
      // Retain last known metrics so UI remains functional
      if (lastKnownGood.current) {
        setData(lastKnownGood.current);
      }
    } finally {
      setLoading(false);
      setIsLiveSyncing(false);
    }
  }, []);

  // Return new diagnostics state alongside the old ones for compatibility,
  // since the panel probably uses \`telemetry\` currently.
`;

code = code.replace("export function useSystemDiagnostics(pollInterval = 10000) {", replacementStr);

const endReturnTagStr = `  return { telemetry, telemetryHistory, latencyMs, status, isFetching, refetch: fetchDiagnostics, computeDebt, emailServiceStatus, triggerTestEmail, emailService, verifyEmailDelivery };`;
const endReturnReplacementStr = `  return {
    telemetry, telemetryHistory, latencyMs, status, isFetching, refetch: fetchDiagnostics,
    computeDebt, emailServiceStatus, triggerTestEmail, emailService, verifyEmailDelivery,
    diagnostics: data,
    diagnosticsLoading: loading,
    diagnosticsError: error,
    isLiveSyncing,
    refreshDiagnostics: fetchDiagnosticsNew
  };`;

code = code.replace(endReturnTagStr, endReturnReplacementStr);

// Now patch the fetch logic interval hook:
const useEffectIntervalCode = `  useEffect(() => {
    let isMounted = true;
    let timeoutId = null;`;

const newUseEffectIntervalCode = `  useEffect(() => {
    fetchDiagnosticsNew();
    const interval = setInterval(fetchDiagnosticsNew, pollInterval);
    return () => clearInterval(interval);
  }, [fetchDiagnosticsNew, pollInterval]);

  useEffect(() => {
    let isMounted = true;
    let timeoutId = null;`;

code = code.replace(useEffectIntervalCode, newUseEffectIntervalCode);

fs.writeFileSync(path, code);
console.log("Hook patched successfully");
