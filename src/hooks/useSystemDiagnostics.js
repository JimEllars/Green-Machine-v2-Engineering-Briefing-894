import { useState, useEffect, useCallback, useTransition } from 'react';
import { supabase } from '../supabaseClient';
import { getWorkerUrl } from '../utils/workerUrl';

export const useSystemDiagnostics = () => {
  const [telemetry, setTelemetry] = useState(null);
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const [latencyMs, setLatencyMs] = useState(0);
  const [status, setStatus] = useState('Offline'); // 'Healthy', 'Degraded', 'Offline'
  const [isFetching, setIsFetching] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [, startTransition] = useTransition();

  const fetchDiagnostics = useCallback(async () => {
    setIsFetching(true);
    let currentLatency = 0;
    const start = performance.now();
    let edgeSuccess = false;
    let dbSuccess = false;
    let localTelemetry = null;
    let dbLatencyMs = 0;

    try {
      // 1. Edge Worker Telemetry
      const workerUrl = getWorkerUrl();
      const edgeRes = await fetch(`${workerUrl}/api/health`, {
         headers: {
            'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || 'default-internal-key-replace-in-production'
         }
      });
      if (edgeRes.ok) {
        const data = await edgeRes.json().catch(() => ({}));
        localTelemetry = data;
        setTelemetry(data);
        edgeSuccess = true;
      }
    } catch (e) {
      console.error('Edge health check failed', e);
    }

    try {
      // 2. Supabase DB Check & Latency
      const dbStart = performance.now();
      // Using an arbitrary fast query to measure latency
      const { error } = await supabase.auth.getSession();
      dbLatencyMs = Math.round(performance.now() - dbStart);

      if (!error) {
         dbSuccess = true;
      }
    } catch (e) {
      console.error('DB health check failed', e);
    }

    currentLatency = Math.round(performance.now() - start);
    setLatencyMs(currentLatency);

    const newTelemetryEvent = {
       timestamp: new Date().toISOString(),
       edgeLatencyMs: localTelemetry?.latencyMs || currentLatency,
       dbLatencyMs,
       totalLatencyMs: currentLatency,
       status: edgeSuccess && dbSuccess ? 'Healthy' : (edgeSuccess || dbSuccess ? 'Degraded' : 'Offline')
    };

    setTelemetryHistory(prev => {
       const newHistory = [...prev, newTelemetryEvent];
       return newHistory.slice(-50); // Cap at 50 data points
    });

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
    let isMounted = true;
    let timeoutId = null;

    const runFetch = async () => {
      if (document.visibilityState === 'hidden') {
         // Backoff when hidden, delay next check significantly
         timeoutId = setTimeout(runFetch, 120000); // 2 minutes
         return;
      }

      if (isMounted) {
        await fetchDiagnostics().catch(e => console.error("Diagnostics fetch error handled:", e));
      }

      if (isMounted) {
        // Exponential backoff logic based on error count
        // Using a function form of state to ensure latest value
        setErrorCount(currentErrorCount => {
           const intervalTime = currentErrorCount === 0 ? 30000 : Math.min(30000 * Math.pow(2, currentErrorCount), 300000);
           timeoutId = setTimeout(runFetch, intervalTime);
           return currentErrorCount;
        });
      }
    };

    runFetch();

    const handleVisibilityChange = () => {
       if (document.visibilityState === 'visible') {
          // If returning to tab, fetch immediately and reset timer
          clearTimeout(timeoutId);
          runFetch();
       }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchDiagnostics]);



  // Setup realtime subscription for external telemetry streams
  useEffect(() => {
    let isMounted = true;
    let lastUpdate = 0;

    const channel = supabase.channel('telemetry_stream')
      .on(
        'broadcast',
        { event: 'telemetry_update' },
        (payload) => {
          if (isMounted && payload.payload) {
            const now = Date.now();
            if (now - lastUpdate > 1000) { // Throttle to max 1 update per second
              lastUpdate = now;
              startTransition(() => {
                 // Only update if we received valid non-blocking telemetry
                 setTelemetry(prev => ({ ...prev, ...payload.payload, _source: 'realtime' }));
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return { telemetry, telemetryHistory, latencyMs, status, isFetching, refetch: fetchDiagnostics };
};
