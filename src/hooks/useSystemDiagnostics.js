import { useState, useEffect, useCallback, useTransition } from 'react';
import { supabase } from '../supabaseClient';
import { getWorkerUrl } from '../utils/workerUrl';

import { getSessionState } from '../supabaseClient';
export const useSystemDiagnostics = (isAuthenticated = true) => {
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
        // Check if the response follows the standardized { status, data, ... } wrapper
        if (data && data.status && Array.isArray(data.data) && data.data.length > 0) {
          localTelemetry = data.data[0];
          setTelemetry(prev => ({ ...prev, ...data.data[0] }));
        } else {
          // Fallback for non-standardized or legacy payload
          localTelemetry = data;
          setTelemetry(prev => ({ ...prev, ...data }));
        }
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
           setTelemetry(prev => ({
               ...prev,
               status: "fallback",
               edge_version: "v2.4.0-mock",
               environment: "local",
               offline: true
           }));
       }
    }

    setIsFetching(false);
  }, []);


  useEffect(() => {
    let isMounted = true;
    let timeoutId = null;

    const runFetch = async () => {
      if (!isAuthenticated) return;

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

    if (!isAuthenticated) return;

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


  const [computeDebt, setComputeDebt] = useState([]);

  useEffect(() => {
    let isMounted = true;
    const fetchComputeDebt = async () => {
      try {
        const { data, error } = await supabase
          .from('api_usage_logs')
          .select('satellite_app, tokens_used, compute_cost, gross_revenue');
          // Wait, the table schema isn't known exactly, but instructions say:
          // "Query AXiM Core public.api_usage_logs to aggregate compute expenses per satellite app (axim-passport-sso, axim-web3-frontend, axim-ceo-dept-app, foreman-os, ground-game)."
        if (error) {
           console.error("Failed to fetch api_usage_logs", error);
           return;
        }

        // Aggregate
        const aggregated = {};
        if (data) {
          data.forEach(log => {
             const app = log.satellite_app || 'unknown';
             if (!aggregated[app]) aggregated[app] = { computeCost: 0, revenue: 0 };
             aggregated[app].computeCost += Number(log.compute_cost) || 0;
             aggregated[app].revenue += Number(log.gross_revenue) || 0;
          });
          const result = Object.keys(aggregated).map(app => ({
             app,
             computeCost: aggregated[app].computeCost,
             revenue: aggregated[app].revenue,
             ratio: aggregated[app].revenue > 0 ? (aggregated[app].computeCost / aggregated[app].revenue) : 0
          }));
          if (isMounted) setComputeDebt(result);
        }
      } catch (e) {
        console.error("Compute debt fetch failed", e);
      }
    };

    fetchComputeDebt();
    return () => { isMounted = false; };
  }, []);

  return { telemetry, telemetryHistory, latencyMs, status, isFetching, refetch: fetchDiagnostics, computeDebt };

};
