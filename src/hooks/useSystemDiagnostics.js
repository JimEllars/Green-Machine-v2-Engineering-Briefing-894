import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { getWorkerUrl } from '../utils/workerUrl';

export const useSystemDiagnostics = () => {
  const [telemetry, setTelemetry] = useState(null);
  const [latencyMs, setLatencyMs] = useState(0);
  const [status, setStatus] = useState('Offline'); // 'Healthy', 'Degraded', 'Offline'
  const [isFetching, setIsFetching] = useState(false);
  const [errorCount, setErrorCount] = useState(0);

  const fetchDiagnostics = useCallback(async () => {
    setIsFetching(true);
    let currentLatency = 0;
    const start = performance.now();
    let edgeSuccess = false;
    let dbSuccess = false;
    let localTelemetry = null;

    try {
      // 1. Edge Worker Telemetry
      const workerUrl = getWorkerUrl();
      const edgeRes = await fetch(`${workerUrl}/api/health`, {
         headers: {
            'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || 'default-internal-key-replace-in-production'
         }
      });
      if (edgeRes.ok) {
        const data = await edgeRes.json();
        localTelemetry = data;
        setTelemetry(data);
        edgeSuccess = true;
      }
    } catch (e) {
      console.error('Edge health check failed', e);
    }

    try {
      // 2. Supabase DB Check
      const { data, error } = await supabase.from('blockchain_transactions').select('*', { count: 'exact', head: true });
      if (!error) {
         dbSuccess = true;
      }
    } catch (e) {
      console.error('DB health check failed', e);
    }

    currentLatency = Math.round(performance.now() - start);
    setLatencyMs(currentLatency);

    if (edgeSuccess && dbSuccess) {
       setStatus('Healthy');
       setErrorCount(0);
    } else if (edgeSuccess || dbSuccess) {
       setStatus('Degraded');
       setErrorCount(prev => prev + 1);
    } else {
       setStatus('Offline');
       setErrorCount(prev => prev + 1);

       // Fallback mock data when edge is unreachable
       if (!localTelemetry) {
           setTelemetry({
               status: "fallback",
               edge_version: "v2.4.0-mock",
               environment: "local",
               offline: true
           });
       }
    }

    setIsFetching(false);
  }, []);

  useEffect(() => {
    fetchDiagnostics();

    // Exponential backoff logic based on error count
    const intervalTime = errorCount === 0 ? 30000 : Math.min(30000 * Math.pow(2, errorCount), 300000);

    const interval = setInterval(() => {
      fetchDiagnostics();
    }, intervalTime);

    return () => clearInterval(interval);
  }, [fetchDiagnostics, errorCount]);

  return { telemetry, latencyMs, status, isFetching, refetch: fetchDiagnostics };
};
