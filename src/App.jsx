import React from 'react';
import StrategyConsultantTerminal from './components/planner/StrategyConsultantTerminal';
import MarketFeedMatrix from './components/planner/MarketFeedMatrix';
import AffiliatePayoutGrid from './components/planner/AffiliatePayoutGrid';
import SafeIcon from './common/SafeIcon';

function App() {
  return (
    <div className="min-h-screen bg-[#05080f] text-slate-200 font-sans selection:bg-emerald-500/30">
      {/* Top Navigation */}
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
            <div className="flex items-center gap-4">
               <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-md border border-slate-700 text-xs text-slate-300">
                <SafeIcon name="Lock" className="w-3.5 h-3.5 text-slate-400" />
                jwt_claim: axim_internal_finance
              </div>
              <button className="p-2 text-slate-400 hover:text-white transition-colors">
                <SafeIcon name="Settings" />
              </button>
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                <SafeIcon name="User" className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Dashboard Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <header className="mb-8">
          <h2 className="text-3xl font-bold text-white mb-2">Financial Command Cockpit</h2>
          <p className="text-slate-400">Autonomous Ecosystem Asset Planner & Ledger Gateway</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Market & Ledger */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            <section>
              <MarketFeedMatrix />
            </section>
            
            <section className="flex-1 min-h-[400px]">
              <AffiliatePayoutGrid />
            </section>
          </div>

          {/* Right Column: AI Consultant */}
          <div className="lg:col-span-4 flex flex-col min-h-[600px]">
            <StrategyConsultantTerminal />
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;