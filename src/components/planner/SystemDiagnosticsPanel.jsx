import React, { useState } from "react";
import { useSystemDiagnostics } from "../../hooks/useSystemDiagnostics";
import SafeIcon from "../../common/SafeIcon";

export default function SystemDiagnosticsPanel() {
  const { diagnosticsState: diagnostics, refreshDiagnosticsState: refreshDiagnostics } = useSystemDiagnostics();
  const [showRaw, setShowRaw] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refreshDiagnostics();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "healthy":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case "degraded":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      default:
        return "bg-rose-500/20 text-rose-400 border-rose-500/30";
    }
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
          <span
            className={`px-2.5 py-1 text-xs font-mono font-medium rounded-full border ${getStatusColor(
              diagnostics?.isDegraded ? "degraded" : (diagnostics?.edgeStatus || 'checking')
            )}`}
          >
            {diagnostics?.isDegraded ? "SYSTEM DEGRADED" : "ALL SYSTEMS NOMINAL"}
          </span>

          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
            title="Refresh Diagnostics"
          >
            <SafeIcon className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} name="RefreshCw" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        {/* Edge Worker */}
        <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <span className="text-xs text-slate-500 uppercase font-mono">Edge Node (Cloudflare)</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-base font-bold text-white font-mono">{diagnostics?.edgeColo || 'UNKNOWN'}</span>
            <span className="text-xs text-slate-400 font-mono">{diagnostics?.edgeLatencyMs || 0}ms</span>
          </div>
          <div className="mt-2 flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full ${diagnostics?.edgeStatus === "healthy" ? "bg-emerald-400" : "bg-rose-400"}`} />
            <span className="text-xs text-slate-400 capitalize">{diagnostics?.edgeStatus || 'checking'}</span>
          </div>
        </div>

        {/* Supabase DB */}
        <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <span className="text-xs text-slate-500 uppercase font-mono">Database (Supabase)</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-base font-bold text-white font-mono">Postgres RLS</span>
            <span className="text-xs text-slate-400 font-mono">{diagnostics?.databaseLatencyMs || 0}ms</span>
          </div>
          <div className="mt-2 flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full ${diagnostics?.databaseStatus === "healthy" ? "bg-emerald-400" : "bg-rose-400"}`} />
            <span className="text-xs text-slate-400 capitalize">{diagnostics?.databaseStatus || 'checking'}</span>
          </div>
        </div>

        {/* Cloudflare KV */}
        <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <span className="text-xs text-slate-500 uppercase font-mono">Edge Ledger KV</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-base font-bold text-white font-mono">LEDGER_KV</span>
          </div>
          <div className="mt-2 flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full ${diagnostics?.kvStatus === "connected" ? "bg-emerald-400" : "bg-amber-400"}`} />
            <span className="text-xs text-slate-400 capitalize">{diagnostics?.kvStatus || 'checking'}</span>
          </div>
        </div>

        {/* Automation Cron */}
        <div className="p-3.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <span className="text-xs text-slate-500 uppercase font-mono">Cron Briefing Engine</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-base font-bold text-white font-mono">
              {diagnostics?.lastCron?.status ? diagnostics.lastCron.status.toUpperCase() : "STANDBY"}
            </span>
            {diagnostics?.lastCron?.durationMs && (
              <span className="text-xs text-slate-400 font-mono">{diagnostics.lastCron.durationMs}ms</span>
            )}
          </div>
          <div className="mt-2 text-xs text-slate-500 truncate">
            {diagnostics?.lastCron?.timestamp ? new Date(diagnostics.lastCron.timestamp).toLocaleTimeString() : "Awaiting run"}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-500 font-mono">
        <span>
          Last sync: {diagnostics?.lastChecked ? diagnostics.lastChecked.toLocaleTimeString() : "Never"}
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
          {JSON.stringify(diagnostics?.rawTelemetry || diagnostics, null, 2)}
        </pre>
      )}
    </div>
  );
}
