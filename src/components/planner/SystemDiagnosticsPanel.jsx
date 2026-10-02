import React, { useState } from "react";
import { useSystemDiagnostics } from "../../hooks/useSystemDiagnostics";
import SafeIcon from "../../common/SafeIcon";

export default function SystemDiagnosticsPanel() {
  const { telemetry: diagnostics, isStale, refreshDiagnostics, diagnosticsLoading: loading, isLiveSyncing } = useSystemDiagnostics();
  const [showRaw, setShowRaw] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refreshDiagnostics();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "ok":
      case "operational":
      case "healthy":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case "degraded":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      default:
        return "bg-rose-500/20 text-rose-400 border-rose-500/30";
    }
  };

  const isDegraded = diagnostics?.status === 'degraded' || diagnostics?.subsystems?.database?.status === 'degraded';

  const getLatencyColor = (latency) => {
    if (latency === undefined || latency === null) return "text-slate-400";
    if (latency < 150) return "text-emerald-400";
    if (latency <= 400) return "text-amber-400";
    return "text-rose-400";
  };

  const getRingColor = (latency) => {
    if (latency === undefined || latency === null) return "bg-slate-500/20 text-slate-400 border-slate-500/40";
    if (latency < 100) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
    if (latency <= 250) return "bg-amber-500/20 text-amber-400 border-amber-500/40";
    return "bg-rose-500/20 text-rose-400 border-rose-500/40";
  };

  const getPulseColor = (latency) => {
    if (latency === undefined || latency === null) return "bg-slate-400";
    if (latency < 100) return "bg-emerald-500 animate-pulse";
    if (latency <= 250) return "bg-amber-500 animate-pulse";
    return "bg-rose-500 animate-pulse";
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800/80 backdrop-blur-md rounded-xl text-slate-100 p-5 shadow-2xl">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <SafeIcon className="w-5 h-5" name="Activity"/>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white tracking-wide uppercase">
              System Telemetry & Edge Diagnostics
            </h3>
            <p className="text-xs text-slate-400">
              Live Edge Fabric, KV State & Background Automation Metrics
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {(!diagnostics?.isLive || isStale) && (
             <div className="flex items-center space-x-1.5 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full">
               <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>
               <span className="text-[10px] uppercase font-bold text-amber-400">Offline / Cached</span>
             </div>
          )}
          {diagnostics?.isLive && !isStale && (
             <div className="flex items-center space-x-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
               <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
               <span className="text-[10px] uppercase font-bold text-emerald-400">Live Edge Telemetry</span>
             </div>
          )}
          {loading && !diagnostics ? (
            <div className="h-6 w-32 bg-slate-800/50 rounded-full animate-pulse"></div>
          ) : (
          <span
            className={`flex items-center space-x-2 px-2.5 py-1 text-xs font-mono font-medium rounded-full border ${getRingColor(diagnostics?.latencyMs)}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${getPulseColor(diagnostics?.latencyMs)}`}></span>
            <span>{isDegraded ? "SYSTEM DEGRADED" : "ALL SYSTEMS NOMINAL"}</span>
          </span>
          )}

          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing || loading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
            title="Refresh Diagnostics"
          >
            <SafeIcon className={`w-4 h-4 ${(isRefreshing || loading) ? 'animate-spin text-emerald-400' : ''}`} name="RefreshCw" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {/* Status Pill Indicators */}
        <div className="flex items-center space-x-2 px-3 py-1.5 bg-slate-800/50 rounded-full border border-slate-700/50 text-xs text-slate-300">
          <span className={`w-2 h-2 rounded-full ${diagnostics?.services?.kv?.status === 'connected' ? 'animate-pulse bg-emerald-500 rounded-full h-2 w-2' : 'bg-amber-400'}`}></span>
          <span>Edge Gateway (KV: {diagnostics?.services?.kv?.latency_ms || 0}ms)</span>
        </div>
        <div className="flex items-center space-x-2 px-3 py-1.5 bg-slate-800/50 rounded-full border border-slate-700/50 text-xs text-slate-300">
          <span className={`w-2 h-2 rounded-full ${diagnostics?.services?.ai_engine?.status === 'active' ? 'animate-pulse bg-emerald-500 rounded-full h-2 w-2' : 'bg-amber-400'}`}></span>
          <span>AI Automation Node ({diagnostics?.services?.ai_engine?.status || 'Active'})</span>
        </div>
        <div className="flex items-center space-x-2 px-3 py-1.5 bg-slate-800/50 rounded-full border border-slate-700/50 text-xs text-slate-300">
          <span className={`w-2 h-2 rounded-full ${diagnostics?.services?.thirdweb_bridge?.status === 'online' ? 'animate-pulse bg-emerald-500 rounded-full h-2 w-2' : 'bg-amber-400'}`}></span>
          <span>Blockchain Bridge ({diagnostics?.services?.thirdweb_bridge?.status || 'Online'})</span>
        </div>
      </div>

      {/* Animated pulse bar for telemetry sync */}
      {isRefreshing || isLiveSyncing ? (
        <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden mb-4">
          <div className="w-1/3 h-full bg-emerald-500 animate-[pulse_1s_ease-in-out_infinite_alternate] shadow-[0_0_10px_rgba(16,185,129,0.8)] rounded-full translate-x-full transition-transform duration-500"></div>
        </div>
      ) : (
        <div className="w-full h-1 bg-transparent mb-4"></div>
      )}

      <div className="flex justify-between items-center mb-4">
         <button
            onClick={handleManualRefresh}
            disabled={isRefreshing || loading || isLiveSyncing}
            className="flex items-center space-x-2 px-4 py-2 text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SafeIcon name="Activity" className={`w-4 h-4 ${isRefreshing || isLiveSyncing ? 'animate-spin' : ''}`} />
            <span>Run Diagnostic Probe</span>
          </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        {loading && !diagnostics ? (
          <>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80 animate-pulse">
                <div className="h-3 w-20 bg-slate-800 rounded mb-2"></div>
                <div className="h-5 w-24 bg-slate-800 rounded mb-3"></div>
                <div className="h-3 w-16 bg-slate-800 rounded"></div>
              </div>
            ))}
          </>
        ) : (
          <>
            {/* Edge Node (Colo) */}
            <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
              <span className="text-xs text-slate-500 uppercase font-mono">Edge Node (Colo)</span>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-base font-bold text-white font-mono px-2 py-0.5 bg-slate-800 rounded">
                    [{diagnostics?.colo || diagnostics?.edge?.colo || diagnostics?.workerRegion || 'UNKNOWN'}]
                </span>
                <span className={`text-xs font-mono font-bold ${getLatencyColor(diagnostics?.latencyMs)}`}>
                    [{diagnostics?.latencyMs || 0} ms]
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                   <span className={`w-2 h-2 rounded-full ${diagnostics?.status === "ok" || diagnostics?.status === "operational" || diagnostics?.status === "healthy" ? "animate-pulse bg-emerald-500 rounded-full h-2 w-2" : "bg-rose-400"}`} />
                   <span className="text-xs text-slate-400 capitalize">{diagnostics?.status || 'checking'}</span>
                </div>
              </div>
            </div>

            {/* Database Rail */}
            <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
              <span className="text-xs text-slate-500 uppercase font-mono">Database Rail</span>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-base font-bold text-white font-mono">Postgres RLS</span>
              </div>
              <div className="mt-2 flex items-center space-x-2">
                <span className={`w-2 h-2 rounded-full ${(diagnostics?.services?.supabase === 'connected' || diagnostics?.subsystems?.database?.configured) ? "bg-emerald-500" : "bg-rose-400"}`} />
                <span className="text-xs text-slate-400 capitalize">{(diagnostics?.services?.supabase === 'connected' || diagnostics?.subsystems?.database?.configured) ? 'configured' : 'checking'}</span>
              </div>
            </div>

            {/* Contract Bridge */}
            <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
              <span className="text-xs text-slate-500 uppercase font-mono">Contract Bridge</span>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-base font-bold text-white font-mono">Web3 Relay</span>
              </div>
              <div className="mt-2 flex items-center space-x-2">
                <span className={`w-2 h-2 rounded-full ${(diagnostics?.services?.thirdweb === 'ready' || diagnostics?.bindings?.thirdweb || diagnostics?.subsystems?.thirdwebBridge?.configured) ? "animate-pulse bg-emerald-500 rounded-full h-2 w-2" : "bg-amber-400"}`} />
                <span className="text-xs text-slate-400 capitalize">{(diagnostics?.services?.thirdweb === 'ready' || diagnostics?.bindings?.thirdweb || diagnostics?.subsystems?.thirdwebBridge?.configured) ? 'Ready' : 'Mock Mode'}</span>
              </div>
            </div>

            {/* Telemetry Latency / Edge Ledger KV */}
            <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
              <span className="text-xs text-slate-500 uppercase font-mono">Telemetry Latency</span>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-base font-bold text-white font-mono">KV State</span>
                 <span className={`text-xs font-mono ${getLatencyColor(diagnostics?.subsystems?.kv?.latencyMs)}`}>
                    [{diagnostics?.subsystems?.kv?.latencyMs || 0} ms]
                </span>
              </div>
              <div className="mt-2 flex items-center space-x-2">
                <span className={`w-2 h-2 rounded-full ${diagnostics?.subsystems?.kv?.status === "healthy" || diagnostics?.subsystems?.kv?.status === "connected" ? "bg-emerald-500" : "bg-amber-400"}`} />
                <span className="text-xs text-slate-400 capitalize">{diagnostics?.subsystems?.kv?.status || 'checking'}</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-500 font-mono">
        <span>
          Last sync: {diagnostics?.lastUpdated ? new Date(diagnostics.lastUpdated).toLocaleTimeString() : (diagnostics?.timestamp ? new Date(diagnostics.timestamp).toLocaleTimeString() : "Never")}
        </span>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-slate-400 hover:text-emerald-400 transition"
        >
          {showRaw ? "Hide Raw Telemetry" : "View Raw JSON"}
        </button>
      </div>

      {showRaw && (
        <pre className="mt-3 p-3 bg-black/60 rounded-lg border border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-48">
          {JSON.stringify(diagnostics, null, 2)}
        </pre>
      )}
    </div>
  );
}
