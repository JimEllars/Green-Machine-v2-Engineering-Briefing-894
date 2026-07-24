import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import StrategyConsultantTerminal from './components/planner/StrategyConsultantTerminal';
import MarketFeedMatrix from './components/planner/MarketFeedMatrix';
import AffiliatePayoutGrid from './components/planner/AffiliatePayoutGrid';


import SafeIcon from './common/SafeIcon';
import SystemDiagnosticsPanel from './components/planner/SystemDiagnosticsPanel';
import { getWorkerUrl } from './utils/workerUrl';


function App() {
  const [selectedTx, setSelectedTx] = useState(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [dlqStatus, setDlqStatus] = useState({ active: false, count: 0, quarantine_count: 0 });
  const [isFlushing, setIsFlushing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [isPurgingQuarantine, setIsPurgingQuarantine] = useState(false);
  const [purgeSuccess, setPurgeSuccess] = useState(false);
  const [isSendingBriefing, setIsSendingBriefing] = useState(false);
  const [briefingSuccess, setBriefingSuccess] = useState(false);

  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [showCriticalAlert, setShowCriticalAlert] = useState(false);

  const handleDiagnosticsUpdate = (status) => {
    setConsecutiveFailures(prev => {
      let isFailure = false;
      if (status.dbConnected === false || status.edgeCacheAvailable === false) {
        isFailure = true;
      }

      const newCount = isFailure ? prev + 1 : 0;
      if (newCount >= 3) {
        setShowCriticalAlert(true);
      } else if (newCount === 0) {
        setShowCriticalAlert(false);
      }
      return newCount;
    });
  };

const checkDlq = async () => {
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/dlq-status`, {
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
         const data = await res.json();
         setDlqStatus({ active: data.active, count: data.count, quarantine_count: data.quarantine_count || 0, emailit_telemetry: data.emailit_telemetry });
      }
    } catch (e) {
      console.error("Failed to fetch DLQ status", e);
    }
  };

  useEffect(() => {
    checkDlq();
    const interval = setInterval(checkDlq, 15000); // Check every 15s
    return () => clearInterval(interval);
  }, []);

  const handleFlushDLQ = async () => {
    setIsFlushing(true);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/dlq-flush`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.remaining) {
          setTimeout(handleFlushDLQ, 2000);
        } else {
          setIsFlushing(false);
        }
        await checkDlq();
      } else {
        setIsFlushing(false);
      }
    } catch(e) {
      console.error('Failed to flush DLQ:', e);
      setIsFlushing(false);
    }
  };


  const handleSyncKV = async () => {
    setIsSyncing(true);
    setSyncSuccess(false);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/cache-sync`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 2000);
      }
    } catch(e) {
      console.error('Failed to sync KV:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  const [sweepSuccess, setSweepSuccess] = useState(false);

  const handlePurgeQuarantine = async () => {
    setIsPurgingQuarantine(true);
    setPurgeSuccess(false);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/quarantine-purge`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setPurgeSuccess(true);
        setTimeout(() => setPurgeSuccess(false), 2000);
        await checkDlq();
      }
    } catch(e) {
      console.error('Failed to purge quarantine:', e);
    } finally {
      setIsPurgingQuarantine(false);
    }
  };

  const handleSendExecBriefing = async () => {
    setIsSendingBriefing(true);
    setBriefingSuccess(false);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/send-exec-briefing`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setBriefingSuccess(true);
        setTimeout(() => setBriefingSuccess(false), 2000);
      }
    } catch(e) {
      console.error('Failed to send exec briefing:', e);
    } finally {
      setIsSendingBriefing(false);
    }
  };

  const handleManualSweep = async () => {
    setIsSweeping(true);

    try {
      // In a real environment, you'd use a service role key for this sensitive operation if the Edge Function requires it,
      // but for this prototype, we'll use the anon key if that's what's available, or a specific env var.
      const authHeader = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY
        ? `Bearer ${import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY}`
        : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/financial-audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify({
          trigger_source: 'manual_sweep_dashboard',
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        console.error('Sweep failed:', response.statusText);
      } else {
        setSweepSuccess(true);
        setTimeout(() => setSweepSuccess(false), 1500);
      }
    } catch (error) {
       console.error('Sweep error:', error);
    } finally {
      setIsSweeping(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      
      {/* Overlays */}


      <nav className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                <SafeIcon name="Hexagon" className="text-slate-900 w-5 h-5" />
              </div>
              <div>
                <h1 className="font-bold tracking-tight text-white leading-none">AXiM Core</h1>
                <span className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">The Green Machine v2</span>
              </div>
            </div>
            
            <div className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
              <a href="#" className="text-white">Dashboard</a>
              <a href="#" className="hover:text-white transition-colors">Ledger</a>
              <a href="#" className="hover:text-white transition-colors">Market Cache</a>
              <a href="#" className="hover:text-white transition-colors">AI Strategies</a>
            </div>

            <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${dlqStatus.active ? 'bg-amber-500/10 border-amber-500/50 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
              <div className={`w-2 h-2 rounded-full ${dlqStatus.active ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
              Edge Buffer Status {dlqStatus.active && `(${dlqStatus.count})`}
            </div>

            <div className="flex items-center gap-4">
               <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-md border border-slate-700 text-xs text-slate-300">
                <SafeIcon name="Lock" className="w-3.5 h-3.5 text-emerald-400" />
                axim_internal_finance
              </div>
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center cursor-pointer hover:border-emerald-500 transition-colors">
                <SafeIcon name="User" className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>
      </nav>

      {showCriticalAlert && (
        <div className="bg-rose-900/90 border-b border-rose-500/50 text-rose-100 px-4 py-3 shadow-[0_4px_20px_rgba(225,29,72,0.3)] sticky top-16 z-40 transition-all duration-300">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <SafeIcon name="AlertTriangle" className="w-5 h-5 text-rose-400 animate-pulse" />
            <p className="text-sm font-bold tracking-wide">CRITICAL PIPELINE DISRUPTION DETECTED: Core Infrastructure Tier Degraded. Ledger Safely Buffered to Edge KV DLQ Cache Node.</p>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-white mb-2">Financial Command Cockpit</h2>
            <p className="text-slate-400 text-sm">Autonomous Ecosystem Asset Planner & Ledger Gateway</p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={handleManualSweep}
              disabled={isSweeping}
              className={`px-4 py-2 ${isSweeping ? 'bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.5)]' : sweepSuccess ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-emerald-600 hover:bg-emerald-500'} disabled:opacity-90 text-white rounded-lg text-sm font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] flex items-center gap-2`}
            >
              {isSweeping ? <SafeIcon name="Loader" className="w-4 h-4 animate-spin" /> : <SafeIcon name="Zap" className="w-4 h-4" />}
              {isSweeping ? 'Scraping Multi-App Resource Debts...' : 'Manual Sweep'}
            </button>
            <button 
              onClick={() => setIsLogsOpen(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-all border border-slate-700 flex items-center gap-2"
            >
              <SafeIcon name="Terminal" className="w-4 h-4" />
              Edge Logs
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Alerts & Stats */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <SystemDiagnosticsPanel dlqStatus={dlqStatus} onDiagnosticsUpdate={handleDiagnosticsUpdate} />
          </div>

          {/* Center Column: Market & Ledger */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <MarketFeedMatrix />
            <AffiliatePayoutGrid onSelectTx={setSelectedTx} />
          </div>

          {/* Right Column: AI Strategy Terminal */}
          <div className="lg:col-span-3 flex flex-col min-h-[600px] sticky top-24">
            <StrategyConsultantTerminal />

            
            <div className="mt-6 bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/50 rounded-xl p-6 shadow-2xl">
              <h3 className="text-white font-bold mb-4 flex items-center gap-2 text-sm">
                <SafeIcon name="Tool" className="text-emerald-500 w-4 h-4" />
                Quick Actions
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleSyncKV}
                  className={`p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider ${isSyncing ? 'bg-emerald-500/20 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)] text-emerald-400' : syncSuccess ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/50 text-slate-300'}`}
                >
                  {isSyncing ? 'Syncing...' : syncSuccess ? 'Synced!' : 'Sync KV'}
                </button>
                <button
                  onClick={handlePurgeQuarantine}
                  className={`p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider ${isPurgingQuarantine ? 'bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] text-amber-400' : purgeSuccess ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-amber-500/50 text-slate-300'}`}
                >
                  {isPurgingQuarantine ? 'Purging...' : purgeSuccess ? 'Purged!' : 'Purge Quarantined Pills'}
                </button>
                {['Mint Batch', 'Audit Logs'].map((action) => (
                  <button key={action} className="p-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg border border-slate-700/50 text-[10px] font-bold text-slate-300 transition-colors uppercase tracking-wider">
                    {action}
                  </button>
                ))}
                <button
                  onClick={handleSendExecBriefing}
                  className={`col-span-2 p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider flex items-center justify-center gap-2 ${isSendingBriefing ? 'bg-indigo-500/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] text-indigo-400' : briefingSuccess ? 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-indigo-500/50 text-slate-300'}`}
                >
                  <SafeIcon name="Mail" className={`w-3 h-3 ${isSendingBriefing ? 'animate-pulse' : ''}`} />
                  {isSendingBriefing ? 'Dispatching...' : briefingSuccess ? 'Briefing Sent!' : 'Dispatch Exec Briefing'}
                </button>
                <button
                  onClick={handleFlushDLQ}
                  className={`col-span-2 p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider flex items-center justify-center gap-2 ${isFlushing ? 'bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] text-amber-400' : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/50 text-amber-500'}`}
                >
                  <SafeIcon name="RefreshCw" className={`w-3 h-3 ${isFlushing ? 'animate-spin' : ''}`} />
                  {isFlushing ? 'Flushing Batch...' : 'Flush DLQ Buffer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-slate-800 mt-12 bg-slate-900/30">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Worker: CF-DAL-01
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Mesh: Thirdweb L2
            </div>
          </div>
          <p className="text-slate-500 text-[10px] font-mono tracking-widest uppercase">
            &copy; 2026 AXIM CORE SYSTEMS // GREEN_MACHINE_V2_PROD
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;