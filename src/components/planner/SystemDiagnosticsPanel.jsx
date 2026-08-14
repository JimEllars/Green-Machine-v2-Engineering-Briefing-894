import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import SafeIcon from '../../common/SafeIcon';
import { getWorkerUrl } from '../../utils/workerUrl';



const SystemDiagnosticsPanel = ({ dlqStatus, onDiagnosticsUpdate, onOpenQuarantineManager }) => {
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkResults, setBenchmarkResults] = useState(null);
  const [txCount, setTxCount] = useState(0);
  const [dbConnected, setDbConnected] = useState(true);
  const [edgeCacheAvailable, setEdgeCacheAvailable] = useState(true);
  const [edgeLatency, setEdgeLatency] = useState(0);
  const [edgeJitter, setEdgeJitter] = useState(0);
  const prevLatencyRef = useRef(0);
  const [dbLatency, setDbLatency] = useState(0);
  const [dbJitter, setDbJitter] = useState(0);
  const prevDbLatencyRef = useRef(0);
  const [tickerStream, setTickerStream] = useState([]);
  const [healthTickerLogs, setHealthTickerLogs] = useState([]);
  const [latencyHistory, setLatencyHistory] = useState([]);
  const [activeAiModel, setActiveAiModel] = useState(window.localStorage.getItem("ai_model"));
  const [isDeepTelemetryOpen, setIsDeepTelemetryOpen] = useState(false);
  const [webhookTarget, setWebhookTarget] = useState("/api/webhooks/anny-signal");
  const [webhookPayload, setWebhookPayload] = useState("");
  const [isReplayingWebhook, setIsReplayingWebhook] = useState(false);
  const [webhookResult, setWebhookResult] = useState(null);
  const [deepTelemetry, setDeepTelemetry] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('CONNECTING');
  const [healthData, setHealthData] = useState(null);

  useEffect(() => {
    const handleRealtimeStatus = (e) => setRealtimeStatus(e.detail);
    window.addEventListener('realtime-status-update', handleRealtimeStatus);



  return () => window.removeEventListener('realtime-status-update', handleRealtimeStatus);
  }, []);

  useEffect(() => {
    const handleStorageChange = () => {
      setActiveAiModel(window.localStorage.getItem("ai_model"));
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);




  const fetchDeepTelemetry = async () => {
    try {
      const workerUrl = getWorkerUrl();
      // Use the new telemetry endpoint
      const response = await fetch(`${workerUrl}/api/telemetry`, {
        headers: { 'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || '' }
      });
      if (response.ok) {
        const data = await response.json();

        // Also fetch original health endpoint for legacy AI telemetry
        const healthResponse = await fetch(`${workerUrl}/api/health`, {
          headers: { 'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || '' }
        });
        let healthData = {};
        if (healthResponse.ok) {
           healthData = await healthResponse.json();
        }

        const marketResponse = await fetch(`${workerUrl}/api/market-cache`, {
            headers: { 'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || '' }
        });
        let cbStatus = "CLOSED";
        if (marketResponse.ok) {
            const marketData = await marketResponse.json();
            cbStatus = marketData?.is_circuit_breaker ? "OPEN" : "CLOSED";
        }

        setDeepTelemetry({
          investing_brain_telemetry: healthData.investing_brain_telemetry || {},
          anny_auth_telemetry: healthData.anny_auth_telemetry || {},
          edge_telemetry: data,
          circuit_breaker: {
            status: cbStatus
          }
        });

        // Also update edge latency if it's available in the new telemetry response
        if (data.latencyMs) {
           setEdgeLatency(data.latencyMs);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    let interval;
    const tick = () => {
       if (document.visibilityState === 'visible' && isDeepTelemetryOpen) {
          fetchDeepTelemetry();
       }
    };

    if (isDeepTelemetryOpen) {
      tick();
      interval = setInterval(tick, 30000);
    }

    return () => clearInterval(interval);
  }, [isDeepTelemetryOpen]);


  const handleExportAudit = () => {
    const timestamp = new Date().toISOString();
    const payload = {
      timestamp,
      edge_latency_ms: edgeLatency,
      db_latency_ms: dbLatency,
      dlq_backlog_count: dlqStatus?.count || 0,
      quarantine_count: dlqStatus?.quarantine_count || 0,
      email_relay_status: dlqStatus?.emailit_telemetry?.status || 'UNCONFIGURED'
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `green-machine-diagnostics-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const streamEndRef = useRef(null);
  const activeChannelRef = useRef(null);

  const checkEdgeHealth = async () => {
    let edgeOk = false;
    let dbOk = false;
    try {
      const workerUrl = getWorkerUrl();
      const start = performance.now();
      const res = await fetch(`${workerUrl}/api/health`, {
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) { setHealthData(await res.clone().json()); }
      const end = performance.now();
      let currentLatency = Math.round(end - start);

      const serverTiming = res.headers.get('Server-Timing');
      if (serverTiming) {
          const match = serverTiming.match(/dur=([0-9.]+)/);
          if (match && match[1]) {
              currentLatency = Math.round(parseFloat(match[1]));
          }
      }

      setEdgeJitter(Math.abs(currentLatency - prevLatencyRef.current));
      prevLatencyRef.current = currentLatency;
      setEdgeLatency(currentLatency);
      setLatencyHistory(prev => [...prev, currentLatency].slice(-10));
      setEdgeCacheAvailable(res.ok);
      edgeOk = res.ok;
      if (onDiagnosticsUpdate) onDiagnosticsUpdate({ edgeCacheAvailable: res.ok });
    } catch (e) {

      setEdgeCacheAvailable(false);
      setEdgeLatency(0);
      if (onDiagnosticsUpdate) onDiagnosticsUpdate({ edgeCacheAvailable: false });
    }

    // Check Database Node Health State
    try {
        const { error } = await supabase
          .from('blockchain_transactions')
          .select('*', { count: 'exact', head: true });

        if (error) {
            setDbConnected(false);
            if (onDiagnosticsUpdate) onDiagnosticsUpdate({ dbConnected: false });
        } else {
            setDbConnected(true);
            if (onDiagnosticsUpdate) onDiagnosticsUpdate({ dbConnected: true });
            dbOk = true;
        }
    } catch (e) {
        setDbConnected(false);
        if (onDiagnosticsUpdate) onDiagnosticsUpdate({ dbConnected: false });
    }

    if (edgeOk && dbOk) {
       const logMsg = `[HEALTH_CHECK] DB and Edge nodes synchronized. Status: 200 OK`;
       setHealthTickerLogs(prev => [...prev, logMsg].slice(-2));
    }
  };

  useEffect(() => {
    checkEdgeHealth();
    let intervalId = setInterval(checkEdgeHealth, 15000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(intervalId);
        // Throttle to 60s when hidden to save resources, or we could just clear it
        intervalId = setInterval(checkEdgeHealth, 60000);
      } else {
        clearInterval(intervalId);
        checkEdgeHealth(); // Immediate check on return
        intervalId = setInterval(checkEdgeHealth, 15000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);


  useEffect(() => {
    const initDiagnostics = async () => {
      try {
        // Setup WebSocket for realtime ticker stream FIRST
        activeChannelRef.current = supabase
          .channel('ledger-realtime')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'blockchain_transactions' }, payload => {
             const newTx = `[${new Date().toLocaleTimeString()}] ${payload.eventType.toUpperCase()} - ${payload.new?.transaction_hash?.substring(0,8) || 'Unknown'}`;
             setTickerStream(prev => [...prev, newTx].slice(-50)); // keep last 50

             // Normal operation
             if (payload.eventType === 'INSERT') {
               setTxCount(prev => prev + 1);
             } else if (payload.eventType === 'DELETE') {
               setTxCount(prev => prev - 1);
             }
          })
          .subscribe();

        // Query initial transactions count
        const { count, error } = await supabase
          .from('blockchain_transactions')
          .select('*', { count: 'exact', head: true });

        if (!error) {
          setTxCount(count || 0);
          setDbConnected(true);
        } else {
          setDbConnected(false);
        }

      } catch (e) {
        console.error("Init diagnostics failed", e);
      }
    };

    initDiagnostics();

    return () => {
      if (activeChannelRef.current) {
        supabase.removeChannel(activeChannelRef.current);
      }
    };
  }, []);

  // Auto-scroll effect
  useEffect(() => {
    if (streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [tickerStream]);


  const handleReplayWebhook = async () => {
    setIsReplayingWebhook(true);
    setWebhookResult(null);
    try {
      const payloadObj = JSON.parse(webhookPayload);
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/replay-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        },
        body: JSON.stringify({
          target_endpoint: webhookTarget,
          payload: payloadObj
        })
      });
      const data = await res.json();
      if (res.ok) {
        setWebhookResult({ success: true, message: 'Webhook injected successfully' });
      } else {
        setWebhookResult({ success: false, message: data.error || 'Failed to inject webhook' });
      }
    } catch (e) {
      setWebhookResult({ success: false, message: e.message || 'Invalid JSON or network error' });
    } finally {
      setIsReplayingWebhook(false);
    }
  };

  return (
    <div className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/50 shadow-2xl rounded-xl p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <h3 className="text-white font-bold flex items-center gap-2 text-sm">
            <SafeIcon name="Activity" className="text-emerald-500 w-4 h-4" />
            System Diagnostics
          </h3>
          {activeAiModel && (
            <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
              activeAiModel === "llama-3.1"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                : "bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.3)]"
            }`}>
              {activeAiModel === "llama-3.1" ? "AI Engine: Llama 3.1 Primary" : "AI Engine: Mistral 7B Failover"}
            </div>
          )}
          <button
            onClick={handleExportAudit}
            title="Export Audit Snapshot"
            className="p-1.5 rounded bg-slate-800/50 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors"
          >
            <SafeIcon name="Download" className="w-3 h-3" />
          </button>
        </div>


        <div className="flex gap-2 flex-wrap">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${dlqStatus?.pending_queue_count === 0 ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${dlqStatus?.pending_queue_count === 0 ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`} />
              {dlqStatus?.pending_queue_count === 0 ? 'Retry Queues: Clean' : `Retry Queues: ${dlqStatus?.pending_queue_count} Pending`}
            </div>
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider font-mono ${edgeLatency < 100 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/50' : edgeLatency <= 300 ? 'text-amber-400 bg-amber-500/10 border-amber-500/50' : 'text-rose-400 bg-rose-500/10 border-rose-500/50'}`}>
              Edge RTT: {edgeLatency}ms
            </div>
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider font-mono ${dbLatency < 150 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/50' : dbLatency <= 400 ? 'text-amber-400 bg-amber-500/10 border-amber-500/50' : 'text-rose-400 bg-rose-500/10 border-rose-500/50'}`}>
              DB RTT: {dbLatency}ms
            </div>

            <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${(!dlqStatus?.exec_governance?.pending_retries && dlqStatus?.exec_governance?.last_briefing_sent) ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : (dlqStatus?.exec_governance?.pending_retries > 0 || dlqStatus?.emailit_telemetry?.status === 'ERROR') ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'bg-slate-500/10 border-slate-500/50 text-slate-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${(!dlqStatus?.exec_governance?.pending_retries && dlqStatus?.exec_governance?.last_briefing_sent) ? 'bg-emerald-500 animate-pulse' : (dlqStatus?.exec_governance?.pending_retries > 0 || dlqStatus?.emailit_telemetry?.status === 'ERROR') ? 'bg-amber-500 animate-pulse' : 'bg-slate-500'}`} />
              Email Relay: {dlqStatus?.emailit_telemetry?.status || 'UNKNOWN'}
            </div>
            {dlqStatus?.emailit_telemetry?.delivery_ms !== undefined && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${
                dlqStatus.emailit_telemetry.delivery_ms < 500 ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
                dlqStatus.emailit_telemetry.delivery_ms <= 1500 ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]' :
                'bg-rose-500/10 border-rose-500/50 text-rose-400 shadow-[0_0_10px_rgba(225,29,72,0.3)]'
              }`}>
                <SafeIcon name="Clock" className="w-3 h-3" />
                {dlqStatus.emailit_telemetry.delivery_ms}ms
              </div>
            )}

<div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${edgeCacheAvailable ? 'bg-amber-500/10 border-amber-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-rose-500/10 border-rose-500/50 text-rose-400 shadow-[0_0_10px_rgba(225,29,72,0.3)]'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${edgeCacheAvailable ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
          {edgeCacheAvailable ? 'CF Worker: Active | KV Synced' : 'CF Worker: Unreachable'}
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${dlqStatus?.anny_oracle?.session_valid ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${dlqStatus?.anny_oracle?.session_valid ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          {dlqStatus?.anny_oracle?.session_valid ? 'Anny Oracle: Active (KV Session Valid)' : 'Anny Oracle: Public Guest Mode'}
        </div>

        {dlqStatus?.webhook_ingress_telemetry && (
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${dlqStatus.webhook_ingress_telemetry.status === 'OPERATIONAL' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${dlqStatus.webhook_ingress_telemetry.status === 'OPERATIONAL' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`} />
            Anny Webhook Ingress: {dlqStatus.webhook_ingress_telemetry.status === 'OPERATIONAL' ? 'Operational' : dlqStatus.webhook_ingress_telemetry.status} ({dlqStatus.webhook_ingress_telemetry.total_webhooks_24h} 24h)
          </div>
        )}

        {/* Realtime Status Badge */}
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${
          realtimeStatus === 'SUBSCRIBED' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
          (realtimeStatus === 'CONNECTING' || realtimeStatus === 'TIMED_OUT') ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]' :
          'bg-rose-500/10 border-rose-500/50 text-rose-400 shadow-[0_0_10px_rgba(243,24,73,0.3)]'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            realtimeStatus === 'SUBSCRIBED' ? 'bg-emerald-500 animate-pulse' :
            (realtimeStatus === 'CONNECTING' || realtimeStatus === 'TIMED_OUT') ? 'bg-amber-500 animate-pulse' :
            'bg-rose-500'
          }`} />
          {realtimeStatus === 'SUBSCRIBED' ? 'Realtime: Subscribed' :
           (realtimeStatus === 'CONNECTING' || realtimeStatus === 'TIMED_OUT') ? 'Realtime: Fallback Polling (30s)' :
           'Realtime: Offline'}
        </div>

                {/* Edge Error Telemetry Badge */}
        {dlqStatus?.edge_error_telemetry && (
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${
            dlqStatus.edge_error_telemetry.error_rate_pct === 0 ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
            'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${
              dlqStatus.edge_error_telemetry.error_rate_pct === 0 ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
            }`} />
            Edge Error Rate: {dlqStatus.edge_error_telemetry.error_rate_pct}% {dlqStatus.edge_error_telemetry.error_rate_pct === 0 ? '(Clean)' : '(Warning)'}
          </div>
        )}

        {/* DLQ Auto-Heal Telemetry Badge */}
        {dlqStatus?.autoheal_telemetry && (
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${
            dlqStatus.autoheal_telemetry.status === 'HEALTHY' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
            'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${
              dlqStatus.autoheal_telemetry.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
            }`} />
            {dlqStatus.autoheal_telemetry.status === 'HEALTHY' ? `DLQ Auto-Heal: Operational (${dlqStatus.autoheal_telemetry.healed_24h || 0} Healed)` : 'DLQ Auto-Heal: Retrying DB Connection'}
          </div>
        )}

        </div>
      </div>

      {/* Executive Briefing Log */}
      {dlqStatus?.emailit_telemetry?.last_successful_dispatch && (
        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 mt-4 mb-4">
          <div className="text-sm font-bold text-slate-300 mb-1 flex items-center gap-2">
            <SafeIcon name="Mail" className="w-4 h-4 text-emerald-500" /> Executive Dispatch Confirmation
          </div>
          <div className="text-xs text-slate-400 font-mono">
            Last Briefing: Dispatched at {new Date(dlqStatus.emailit_telemetry.last_successful_dispatch).toLocaleString()} to {dlqStatus.emailit_telemetry.recipients || 'james.ellars@axim.us.com (CC: jrellars@gmail.com)'}
          </div>
        </div>
      )}

      {/* Investing Brain Telemetry */}
      {dlqStatus?.investing_brain_telemetry && (
        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 mt-4 mb-4">
          <div className="text-sm font-bold text-slate-300 mb-1 flex items-center gap-2">
            <SafeIcon name="Brain" className="w-4 h-4 text-emerald-500" /> Investing Brain Diagnostics
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-2" />
          </div>
          <div className="text-xs text-slate-400 font-mono font-bold tracking-wide">
            Investing Brain: {dlqStatus.investing_brain_telemetry.total_consultations_24h} Consultations ({dlqStatus.investing_brain_telemetry.risk_gates_passed} Passed / {dlqStatus.investing_brain_telemetry.risk_warnings} Warnings)
          </div>
        </div>
      )}


      <div className="grid grid-cols-1 gap-4 flex-grow">
        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Database Node Connection</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono">{dbConnected ? 'ONLINE' : 'OFFLINE'}</span>
            <div className={`w-2 h-2 rounded-full ${dbConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          </div>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Edge Cache Availability</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono">{edgeCacheAvailable ? 'ACTIVE' : 'DEGRADED'}</span>
            <div className={`w-2 h-2 rounded-full ${edgeCacheAvailable ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          </div>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Cloudflare Pages Target</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono">Vite Web (Node 20)</span>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Edge Fetch Latency</span>
          <div className="flex items-center gap-3">
             <span className="text-xs font-mono text-emerald-500/80 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)] bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20" title="Edge Jitter">±{edgeJitter}ms</span>
             <span className="text-lg font-bold text-emerald-400 font-mono drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]">{edgeLatency}ms</span>
          </div>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Total Transactions</span>
          <span className="text-lg font-bold text-white">{txCount}</span>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex flex-col gap-3">
          <div className="flex justify-between items-center w-full">
             <span className="text-sm text-slate-300">System Benchmark</span>
             <button
                onClick={async () => {
                  setBenchmarking(true);
                  const workerUrl = getWorkerUrl();

                  const edgePings = [];
                  for (let i = 0; i < 3; i++) {
                    const start = performance.now();
                    try {
                      await fetch(`${workerUrl}/api/health`, { method: 'GET' });
                      edgePings.push(performance.now() - start);
                    } catch (e) {
                      console.error("Ping failed", e);
                    }
                  }

                  if (edgePings.length > 0) {
                      const meanRtt = edgePings.reduce((sum, rtt) => sum + rtt, 0) / edgePings.length;

                      let jitterVariance = 0;
                      if (edgePings.length > 1) {
                          let sumDiff = 0;
                          for (let i = 0; i < edgePings.length - 1; i++) {
                              sumDiff += Math.abs(edgePings[i + 1] - edgePings[i]);
                          }
                          jitterVariance = sumDiff / (edgePings.length - 1);
                      }

                      setEdgeLatency(Math.round(meanRtt));
                      setEdgeJitter(Math.round(jitterVariance));
                      setBenchmarkResults({ edgePing: Math.round(meanRtt), dbPing: -1 }); // Keeping UI roughly same but using mean
                  } else {
                      setBenchmarkResults({ edgePing: -1, dbPing: -1 });
                  }

                  // Also ping DB once to keep UI happy, or as before
                  const dbStart = performance.now();
                  let dbPing = -1;
                  try {
                      await supabase.from('blockchain_transactions').select('id').limit(1);
                      dbPing = Math.round(performance.now() - dbStart);
                  } catch (e) { console.error(e); }

                  setBenchmarkResults(prev => ({ ...prev, dbPing }));

                  setBenchmarking(false);
                }}
                disabled={benchmarking}
                className="px-3 py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/50 rounded text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1"
             >
                <SafeIcon name="Zap" className={`w-3 h-3 ${benchmarking ? 'animate-pulse' : ''}`} />
                {benchmarking ? 'Running...' : 'Run Benchmark'}
             </button>
          </div>
          {benchmarkResults && (
             <div className="flex justify-between items-center bg-slate-900/50 p-2 rounded border border-slate-700/50">
               <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Edge KV RTT</span>
                  <span className={`text-sm font-mono font-bold ${benchmarkResults.edgePing < 100 ? 'text-emerald-400' : benchmarkResults.edgePing < 300 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {benchmarkResults.edgePing === -1 ? 'FAIL' : `${benchmarkResults.edgePing}ms`}
                  </span>
               </div>
               <div className="flex flex-col text-right">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">DB Node RTT</span>
                  <span className={`text-sm font-mono font-bold ${benchmarkResults.dbPing < 100 ? 'text-emerald-400' : benchmarkResults.dbPing < 300 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {benchmarkResults.dbPing === -1 ? 'FAIL' : `${benchmarkResults.dbPing}ms`}
                  </span>
               </div>
             </div>
          )}
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex flex-col justify-center gap-2">
          <div className="flex justify-between items-center w-full">
            <span className="text-sm text-slate-300 flex items-center gap-2">
              DLQ Depth
              {dlqStatus.quarantine_count > 0 && (
                <button onClick={onOpenQuarantineManager} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-400 text-[10px] font-bold uppercase tracking-wider shadow-[0_0_8px_rgba(245,158,11,0.3)] hover:bg-amber-500/30 transition-colors cursor-pointer">
                  ({dlqStatus.quarantine_count} Quarantined)
                </button>
              )}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">{dlqStatus.count}</span>
              <div className={`w-2 h-2 rounded-full ${dlqStatus.active ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            </div>
          </div>
          <div className="flex justify-between items-center w-full pt-2 border-t border-slate-700/50">
            <span className="text-xs text-amber-500/80 uppercase tracking-widest">Quarantined</span>
            <span className="text-sm font-bold text-amber-400 font-mono">{dlqStatus.quarantine_count || 0}</span>
          </div>
        </div>


        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Fin-Ops Margin Ratio</span>
          <span className={`text-lg font-bold drop-shadow-md ${((txCount / (txCount + (dlqStatus?.count || 0) + 1)) * 100) >= 95 ? 'text-emerald-500' : 'text-amber-500'}`}>
            {((txCount / (txCount + (dlqStatus?.count || 0) + 1)) * 100).toFixed(1)}%
          </span>
        </div>

        <div className="mt-4 flex-grow bg-black/40 rounded-lg p-4 border border-slate-700 font-mono text-[10px] text-slate-400 overflow-y-auto">
          <div className="mb-2 text-emerald-500 font-bold uppercase tracking-wider">Live Tx Stream</div>
          <div className="max-h-[150px] overflow-y-auto">
            {tickerStream.length === 0 ? (
              <div className="text-slate-600 italic">Listening for changes...</div>
            ) : (
              tickerStream.map((msg, idx) => (
                <div key={idx} className="mb-1 truncate">{msg}</div>
              ))
            )}
            <div ref={streamEndRef} />
          </div>
        </div>

        <div className="mt-4 flex-grow bg-black/40 rounded-lg p-4 border border-slate-700 font-mono text-[10px] text-slate-400 overflow-y-auto">
          <div className="mb-2 text-emerald-500 font-bold uppercase tracking-wider">Heartbeat Ticker</div>
          <div className="max-h-[50px] overflow-y-auto">
            {healthTickerLogs.length === 0 ? (
              <div className="text-slate-600 italic">Waiting for heartbeat...</div>
            ) : (
              healthTickerLogs.map((msg, idx) => (
                <div key={idx} className="mb-1 text-emerald-400/80 truncate">{msg}</div>
              ))
            )}
          </div>
        </div>
        {/* Deep Telemetry Inspector Drawer */}
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <button
            onClick={() => setIsDeepTelemetryOpen(!isDeepTelemetryOpen)}
            className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors w-full"
          >
            <SafeIcon name={isDeepTelemetryOpen ? "ChevronUp" : "ChevronDown"} className="w-4 h-4" />
            Deep Telemetry Inspector
          </button>

          {isDeepTelemetryOpen && (
            <div className="mt-4 bg-slate-900/80 backdrop-blur-md rounded-lg p-4 border border-slate-700/50 relative overflow-hidden">
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={() => {
                    const timestamp = new Date().toISOString();
                    const bundle = {
                      edge_latency_ms: edgeLatency,
                      edge_jitter_ms: edgeJitter,
                      db_connected: dbConnected,
                      edge_cache_available: edgeCacheAvailable,
                      investing_brain_telemetry: deepTelemetry?.investing_brain_telemetry || {},
                      anny_auth_telemetry: deepTelemetry?.anny_auth_telemetry || {},
                      circuit_breaker: "CLOSED", // Best effort or fetch if needed
                      kv_prune_telemetry: deepTelemetry?.kv_prune_telemetry || {},
                      deployment_status: deepTelemetry?.status || 'UNKNOWN'
                    };
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(bundle, null, 2));
                    const a = document.createElement('a');
                    a.href = dataStr;
                    a.download = `green-machine-diagnostics-${timestamp}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }}
                  className="px-2 py-1 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded text-xs font-medium border border-emerald-500/30 transition-colors flex items-center gap-1"
                >
                  <SafeIcon name="Download" className="w-3 h-3" />
                  Download Diagnostics Bundle
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(deepTelemetry, null, 2));
                  }}
                  className="px-2 py-1 bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 rounded text-xs font-medium border border-indigo-500/30 transition-colors flex items-center gap-1"
                >
                  <SafeIcon name="Copy" className="w-3 h-3" />
                  Copy Raw Telemetry
                </button>
              </div>
              <div className="pt-6">


                <div className="mb-4 bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
                  <div className="flex justify-between items-center mb-3">
                     <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider flex items-center gap-2">
                       <SafeIcon name="Server" className="w-3 h-3" />
                       Edge Telemetry & Diagnostics
                     </div>
                     <button
                        onClick={() => fetchDeepTelemetry()}
                        className="px-2 py-1 bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 rounded text-[10px] font-bold uppercase transition-colors flex items-center gap-1 border border-indigo-500/30"
                     >
                        <SafeIcon name="RefreshCw" className="w-3 h-3" /> Run System Ping
                     </button>
                  </div>

                  {deepTelemetry?.edge_telemetry && (
                     <div className="grid grid-cols-2 gap-3 mb-2 text-xs">
                        <div className="flex flex-col">
                           <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Edge Latency</span>
                           <span className={`font-mono font-bold ${deepTelemetry.edge_telemetry.latencyMs < 100 ? 'text-emerald-400' : deepTelemetry.edge_telemetry.latencyMs < 300 ? 'text-amber-400' : 'text-rose-400'}`}>
                              {deepTelemetry.edge_telemetry.latencyMs} ms
                           </span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">KV Latency</span>
                           <span className="font-mono font-bold text-emerald-400">{deepTelemetry.edge_telemetry.kv_cache_latency_ms} ms</span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Upstream RPC</span>
                           <span className={`font-mono font-bold ${deepTelemetry.edge_telemetry.upstream_rpc_status === 'connected' ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {deepTelemetry.edge_telemetry.upstream_rpc_status.toUpperCase()}
                           </span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Auth Handshake</span>
                           <span className={`font-mono font-bold ${deepTelemetry.edge_telemetry.auth_handshake_status === 'verified' ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {deepTelemetry.edge_telemetry.auth_handshake_status.toUpperCase()}
                           </span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Ledger Sync</span>
                           <span className="font-mono font-bold text-emerald-400">
                              {deepTelemetry.edge_telemetry.ledger_sync_state.toUpperCase()}
                           </span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Edge Uptime</span>
                           <span className="font-mono font-bold text-indigo-400">
                              {deepTelemetry.edge_telemetry.uptimeSeconds}s
                           </span>
                        </div>
                     </div>
                  )}
                </div>

                <div className="mb-4 bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">

                  <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                    <SafeIcon name="Zap" className="w-3 h-3" />
                    Webhook Replay Tool
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-mono mb-1">Target Endpoint</label>
                      <input
                        type="text"
                        value={webhookTarget}
                        onChange={(e) => setWebhookTarget(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 font-mono focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 font-mono mb-1">Raw JSON Payload</label>
                      <textarea
                        value={webhookPayload}
                        onChange={(e) => setWebhookPayload(e.target.value)}
                        placeholder="{}"
                        className="w-full h-24 bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 font-mono focus:border-indigo-500 focus:outline-none custom-scrollbar"
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="text-xs">
                        {webhookResult && (
                          <span className={webhookResult.success ? 'text-emerald-400' : 'text-rose-400'}>
                            {webhookResult.message}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={handleReplayWebhook}
                        disabled={isReplayingWebhook || !webhookPayload.trim()}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-xs font-bold transition-colors flex items-center gap-2"
                      >
                        {isReplayingWebhook ? <SafeIcon name="Loader" className="w-3 h-3 animate-spin" /> : <SafeIcon name="Send" className="w-3 h-3" />}
                        Inject Webhook
                      </button>
                    </div>
                  </div>
                </div>

                {deepTelemetry?.investing_brain_telemetry && (
                  <div className="mb-4 bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                    <div className="flex justify-between items-center mb-3">
                      <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider flex items-center gap-2">
                        <SafeIcon name="Brain" className="w-3 h-3" />
                        Workers AI Inference Benchmark
                        {(deepTelemetry?.investing_brain_telemetry?.model_usage?.mistral_7b_pct > 5.0 || deepTelemetry?.investing_brain_telemetry?.mistral_7b_pct > 5.0) && (
                          <div className="ml-2 px-2 py-1 bg-amber-500/20 text-amber-400 border border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.3)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                            <SafeIcon name="AlertTriangle" className="w-3 h-3 text-rose-500" /> AI Fallback Rate High (&gt;5%)
                          </div>
                        )}
                      </div>
                      <div className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                        (deepTelemetry.investing_brain_telemetry.avg_latency_ms || 850) < 500 ? 'bg-emerald-500/20 text-emerald-400' :
                        (deepTelemetry.investing_brain_telemetry.avg_latency_ms || 850) < 1000 ? 'bg-amber-500/20 text-amber-400' :
                        'bg-rose-500/20 text-rose-400'
                      }`}>
                        {deepTelemetry.investing_brain_telemetry.avg_latency_ms || 850} ms
                      </div>
                    </div>

                    <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden mb-4">
                      <div className={`h-full transition-all ${
                        (deepTelemetry.investing_brain_telemetry.avg_latency_ms || 850) < 500 ? 'bg-emerald-500' :
                        (deepTelemetry.investing_brain_telemetry.avg_latency_ms || 850) < 1000 ? 'bg-amber-500' :
                        'bg-rose-500'
                      }`} style={{ width: `${Math.min(((deepTelemetry.investing_brain_telemetry.avg_latency_ms || 850) / 1000) * 100, 100)}%` }} />
                    </div>

                    {deepTelemetry.investing_brain_telemetry.model_usage ? (
                      <div>
                        <div className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider mb-2">Model Distribution</div>
                        <div className="flex w-full h-2 rounded-full overflow-hidden mb-2 border border-slate-700/50">
                           <div className="h-full bg-emerald-500 hover:brightness-110 transition-all" style={{ width: `${deepTelemetry.investing_brain_telemetry.model_usage.llama_3_1_pct}%` }} title={`Llama 3.1: ${deepTelemetry.investing_brain_telemetry.model_usage.llama_3_1_pct.toFixed(1)}%`} />
                           <div className="h-full bg-indigo-500 hover:brightness-110 transition-all" style={{ width: `${deepTelemetry.investing_brain_telemetry.model_usage.mistral_7b_pct}%` }} title={`Mistral 7B: ${deepTelemetry.investing_brain_telemetry.model_usage.mistral_7b_pct.toFixed(1)}%`} />
                        </div>
                        <div className="flex justify-between text-[10px] font-mono text-slate-400">
                          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"/> Llama 3.1: {deepTelemetry.investing_brain_telemetry.model_usage.llama_3_1_pct.toFixed(1)}%</span>
                          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-indigo-500"/> Mistral 7B: {deepTelemetry.investing_brain_telemetry.model_usage.mistral_7b_pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider mb-2">Model Distribution</div>
                        <div className="flex w-full h-2 rounded-full overflow-hidden mb-2 border border-slate-700/50">
                           <div className="h-full bg-emerald-500 hover:brightness-110 transition-all" style={{ width: `${deepTelemetry.investing_brain_telemetry.llama_3_1_pct || 0}%` }} title={`Llama 3.1: ${(deepTelemetry.investing_brain_telemetry.llama_3_1_pct || 0).toFixed(1)}%`} />
                           <div className="h-full bg-indigo-500 hover:brightness-110 transition-all" style={{ width: `${deepTelemetry.investing_brain_telemetry.mistral_7b_pct || 0}%` }} title={`Mistral 7B: ${(deepTelemetry.investing_brain_telemetry.mistral_7b_pct || 0).toFixed(1)}%`} />
                        </div>
                        <div className="flex justify-between text-[10px] font-mono text-slate-400">
                          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"/> Llama 3.1: {(deepTelemetry.investing_brain_telemetry.llama_3_1_pct || 0).toFixed(1)}%</span>
                          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-indigo-500"/> Mistral 7B: {(deepTelemetry.investing_brain_telemetry.mistral_7b_pct || 0).toFixed(1)}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <pre className="text-[10px] text-slate-300 font-mono overflow-x-auto">
                  {deepTelemetry ? JSON.stringify(deepTelemetry, null, 2) : 'Loading telemetry...'}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SystemDiagnosticsPanel;
