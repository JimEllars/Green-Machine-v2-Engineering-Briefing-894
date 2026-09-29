import React, { useState } from "react";
import { useSystemDiagnostics } from "../../hooks/useSystemDiagnostics";
import SafeIcon from "../../common/SafeIcon";

export default function SystemDiagnosticsPanel() {
  const { telemetry: diagnostics, isStale, refreshDiagnostics, diagnosticsLoading: loading } = useSystemDiagnostics();
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
    if (!latency) return "text-slate-400";
    if (latency < 100) return "text-emerald-400";
    if (latency < 300) return "text-amber-400";
    return "text-rose-400";
  };

  return (
    <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl p-5 shadow-2xl">
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
               <span className="text-[10px] uppercase font-bold text-emerald-400">Live Edge Heartbeat</span>
             </div>
          )}
          <span
            className={`px-2.5 py-1 text-xs font-mono font-medium rounded-full border ${getStatusColor(
              isDegraded ? "degraded" : (diagnostics?.status || 'checking')
            )}`}
          >
            {isDegraded ? "SYSTEM DEGRADED" : "ALL SYSTEMS NOMINAL"}
          </span>

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        {/* Edge Worker */}
        <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <span className="text-xs text-slate-500 uppercase font-mono">Edge Node (Cloudflare)</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-base font-bold text-white font-mono px-2 py-0.5 bg-slate-800 rounded">
                [{diagnostics?.colo || diagnostics?.workerRegion || 'UNKNOWN'}]
            </span>
            <span className={`text-xs font-mono font-bold ${getLatencyColor(diagnostics?.latency)}`}>
                {diagnostics?.latency || 0}ms
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center space-x-2">
               <span className={`w-2 h-2 rounded-full ${diagnostics?.status === "ok" || diagnostics?.status === "operational" || diagnostics?.status === "healthy" ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
               <span className="text-xs text-slate-400 capitalize">{diagnostics?.status || 'checking'}</span>
            </div>
          </div>
        </div>

        {/* Supabase DB */}
        <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <span className="text-xs text-slate-500 uppercase font-mono">Database (Supabase)</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-base font-bold text-white font-mono">Postgres RLS</span>
          </div>
          <div className="mt-2 flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full ${diagnostics?.subsystems?.database?.configured ? "bg-emerald-400" : "bg-rose-400"}`} />
            <span className="text-xs text-slate-400 capitalize">{diagnostics?.subsystems?.database?.configured ? 'configured' : 'checking'}</span>
          </div>
        </div>

        {/* Cloudflare KV */}
        <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <span className="text-xs text-slate-500 uppercase font-mono">Edge Ledger KV</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-base font-bold text-white font-mono">LEDGER_KV</span>
             <span className={`text-xs font-mono ${getLatencyColor(diagnostics?.subsystems?.kv?.latencyMs)}`}>
                {diagnostics?.subsystems?.kv?.latencyMs || 0}ms
            </span>
          </div>
          <div className="mt-2 flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full ${diagnostics?.subsystems?.kv?.status === "healthy" || diagnostics?.subsystems?.kv?.status === "connected" ? "bg-emerald-400" : "bg-amber-400"}`} />
            <span className="text-xs text-slate-400 capitalize">{diagnostics?.subsystems?.kv?.status || 'checking'}</span>
          </div>
        </div>

        {/* Automation Cron */}
        <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <span className="text-xs text-slate-500 uppercase font-mono">External Integrations</span>
          <div className="flex flex-col space-y-1 mt-1">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 font-mono">EmailIt:</span>
               <span className={`font-mono ${diagnostics?.subsystems?.emailit?.configured ? "text-emerald-400" : "text-rose-400"}`}>
                  {diagnostics?.subsystems?.emailit?.configured ? "READY" : "ERR"}
               </span>
            </div>
             <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 font-mono">Thirdweb:</span>
               <span className={`font-mono ${diagnostics?.subsystems?.thirdwebBridge?.configured ? "text-emerald-400" : "text-rose-400"}`}>
                  {diagnostics?.subsystems?.thirdwebBridge?.configured ? "READY" : "ERR"}
               </span>
            </div>
          </div>
        </div>
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
