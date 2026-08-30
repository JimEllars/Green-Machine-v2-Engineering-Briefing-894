import { useState, useEffect, useCallback, useTransition } from 'react';
import { supabase } from '../supabaseClient';
import { getWorkerUrl } from '../utils/workerUrl';

import { getSessionState } from '../supabaseClient';

export const dispatchTelemetry = async (eventType, payload) => {
  try {
    const apiUrl = import.meta.env.VITE_AXIM_CORE_API_URL;
    if (!apiUrl) return;

    // Sanitize transaction payloads
    const sanitizedPayload = {
      tx_hash: payload.tx_hash,
      asset_pair: payload.asset_pair,
      volume: payload.volume,
      ...payload
    };

    await fetch(`${apiUrl}/api/v1/telemetry/micro-app`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
      },
      body: JSON.stringify({
        app_id: "green-machine",
        event_type: eventType,
        data: sanitizedPayload
      })
    });
  } catch (error) {
    console.error("Telemetry dispatch failed:", error);
  }
};

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

    if (edgeSuccess || dbSuccess) {
      dispatchTelemetry("market.polled", { edgeLatencyMs: localTelemetry?.latencyMs || currentLatency, dbLatencyMs, timestamp: new Date().toISOString() });
    }


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


const [computeDebt, setComputeDebt] = useState(() => {
    const cached = localStorage.getItem('axim_compute_debt_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 60000) {
          return parsed.data;
        }
      } catch (e) { /* ignore */ }
    }
    return [];
  });

  useEffect(() => {
    let isMounted = true;
    let timeoutId = null;

    const fetchComputeDebt = async () => {
      if (document.visibilityState === 'hidden') {
         timeoutId = setTimeout(fetchComputeDebt, 60000);
         return;
      }

      try {
        const { data, error } = await supabase
          .from('api_usage_logs')
          .select('satellite_app, tokens_used, compute_cost, gross_revenue');
        if (error) {
           console.error("Failed to fetch api_usage_logs", error);
        } else if (data) {
          const aggregated = {};
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
          if (isMounted) {
            setComputeDebt(result);
            localStorage.setItem('axim_compute_debt_cache', JSON.stringify({ data: result, timestamp: Date.now() }));
          }
        }
      } catch (e) {
        console.error("Compute debt fetch failed", e);
      }

      if (isMounted) {
         timeoutId = setTimeout(fetchComputeDebt, 60000);
      }
    };

    fetchComputeDebt();

    const handleVisibilityChange = () => {
       if (document.visibilityState === 'visible') {
          clearTimeout(timeoutId);
          fetchComputeDebt();
       }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return { telemetry, telemetryHistory, latencyMs, status, isFetching, refetch: fetchDiagnostics, computeDebt };

};
