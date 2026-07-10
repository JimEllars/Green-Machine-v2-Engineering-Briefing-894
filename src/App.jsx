import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import StrategyConsultantTerminal from './components/planner/StrategyConsultantTerminal';
import MarketFeedMatrix from './components/planner/MarketFeedMatrix';
import AffiliatePayoutGrid from './components/planner/AffiliatePayoutGrid';
import SafeIcon from './common/SafeIcon';

function App() {
  const [selectedTx, setSelectedTx] = useState(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);

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
      }
    } catch (error) {
       console.error('Sweep error:', error);
    } finally {
      setIsSweeping(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#05080f] text-slate-200 font-sans selection:bg-emerald-500/30">
      
      {/* Overlays */}


      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
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
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded-lg text-sm font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] flex items-center gap-2"
            >
              {isSweeping ? <SafeIcon name="Loader" className="w-4 h-4 animate-spin" /> : <SafeIcon name="Zap" className="w-4 h-4" />}
              {isSweeping ? 'Sweeping...' : 'Manual Sweep'}
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

          </div>

          {/* Center Column: Market & Ledger */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <MarketFeedMatrix />
            <AffiliatePayoutGrid onSelectTx={setSelectedTx} />
          </div>

          {/* Right Column: AI Strategy Terminal */}
          <div className="lg:col-span-3 flex flex-col min-h-[600px] sticky top-24">
            <StrategyConsultantTerminal />

            
            <div className="mt-6 bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h3 className="text-white font-bold mb-4 flex items-center gap-2 text-sm">
                <SafeIcon name="Tool" className="text-emerald-500 w-4 h-4" />
                Quick Actions
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {['Mint Batch', 'Pause Bridge', 'Sync KV', 'Audit Logs'].map((action) => (
                  <button key={action} className="p-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg border border-slate-700/50 text-[10px] font-bold text-slate-300 transition-colors uppercase tracking-wider">
                    {action}
                  </button>
                ))}
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