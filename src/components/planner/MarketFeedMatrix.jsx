import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '../../common/SafeIcon';
import { getWorkerUrl } from '../../utils/workerUrl';

export default function MarketFeedMatrix() {
  const [marketData, setMarketData] = useState([]);
  const [isStale, setIsStale] = useState(false);
  const [isDegraded, setIsDegraded] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isCircuitBreaker, setIsCircuitBreaker] = useState(false);
  const [cfoFilter, setCfoFilter] = useState('All');
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(30000);



  const [annySignals, setAnnySignals] = useState([]);
  const [isSignalsExpanded, setIsSignalsExpanded] = useState(false);

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const workerUrl = getWorkerUrl();
        const response = await fetch(`${workerUrl}/api/anny-signals`, {
          headers: {
            'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY
          }
        });
        if (response.ok) {
          const data = await response.json();
          if (data && data.success && data.data) {
             setAnnySignals(data.data);
          }
        }
      } catch (error) {
         console.error("Failed to fetch anny signals", error);
      }
    };
    fetchSignals();
    const interval = setInterval(fetchSignals, 15000); // 15s refresh for signals
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchMarketData = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      try {
        // Calling Cloudflare Worker Endpoint
        const workerUrl = getWorkerUrl();
        const response = await fetch(`${workerUrl}/api/market-cache`, {
          signal: controller.signal,
          headers: {
            'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY
          }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
           throw new Error(`Edge Connection Degraded: ${response.status}`);
        }

        const data = await response.json();
        setIsDegraded(false);
        if (data.metadata?.rate_limited) {
          setIsRateLimited(true);
        } else {
          setIsRateLimited(false);
        }
        if (data.metadata?.circuit_breaker) {
          setIsCircuitBreaker(true);
        } else {
          setIsCircuitBreaker(false);
        }
        // Check telemetry timestamp
        if (data && data._telemetry_timestamp) {
          const ageMs = Date.now() - data._telemetry_timestamp;
          if (ageMs > 60000) {
            setIsStale(true);
          } else {
            setIsStale(false);
          }
        }

        // Transform edge data to UI format
        if (data && data.crypto && data.equities) {
           const formattedData = [
            { symbol: 'BTC', name: 'Bitcoin', price: data.crypto.BTC.price, change: data.crypto.BTC.change_24h, type: 'crypto', icon: 'DollarSign', cfo_state: data.crypto.BTC.cfo_state, high_24h: data.crypto.BTC.high_24h, low_24h: data.crypto.BTC.low_24h },
            { symbol: 'ETH', name: 'Ethereum', price: data.crypto.ETH.price, change: data.crypto.ETH.change_24h, type: 'crypto', icon: 'Activity', cfo_state: data.crypto.ETH.cfo_state, high_24h: data.crypto.ETH.high_24h, low_24h: data.crypto.ETH.low_24h },
            { symbol: 'SOL', name: 'Solana', price: data.crypto.SOL.price, change: data.crypto.SOL.change_24h, type: 'crypto', icon: 'Zap', cfo_state: data.crypto.SOL.cfo_state, high_24h: data.crypto.SOL.high_24h, low_24h: data.crypto.SOL.low_24h },
            { symbol: 'AAPL', name: 'Apple Inc.', price: data.equities.AAPL.price, change: data.equities.AAPL.change_24h, type: 'equity', icon: 'Briefcase' },
            { symbol: 'MSFT', name: 'Microsoft', price: data.equities.MSFT.price, change: data.equities.MSFT.change_24h, type: 'equity', icon: 'Monitor' },
          ];
          setMarketData(formattedData);
        }
            } catch (error) {
        clearTimeout(timeoutId);
        console.error("Failed to fetch market data", error);
        setIsDegraded(true);
        // Only set fallback data if no existing data is present
        setMarketData(prev => prev.length > 0 ? prev : [
          { symbol: 'BTC', name: 'Bitcoin', price: 65000, change: 0, type: 'crypto', icon: 'DollarSign' },
          { symbol: 'ETH', name: 'Ethereum', price: 3500, change: 0, type: 'crypto', icon: 'Activity' },
          { symbol: 'SOL', name: 'Solana', price: 150, change: 0, type: 'crypto', icon: 'Zap' },
          { symbol: 'AAPL', name: 'Apple Inc.', price: 175, change: 0, type: 'equity', icon: 'Briefcase' },
          { symbol: 'MSFT', name: 'Microsoft', price: 400, change: 0, type: 'equity', icon: 'Monitor' },
        ]);
      }
    };

    fetchMarketData(); // initial fetch
    if (refreshIntervalMs !== null) {
      const interval = setInterval(fetchMarketData, refreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [refreshIntervalMs]);



  const cfoDistribution = React.useMemo(() => {
    const total = marketData.filter(a => a.cfo_state).length;
    if (total === 0) return { accumulate: 0, wait: 0, distribute: 0 };
    const acc = marketData.filter(a => a.cfo_state === 'accumulate').length;
    const wait = marketData.filter(a => a.cfo_state === 'wait').length;
    const dist = marketData.filter(a => a.cfo_state === 'distribute').length;
    return {
      accumulate: Math.round((acc / total) * 100),
      wait: Math.round((wait / total) * 100),
      distribute: Math.round((dist / total) * 100)
    };
  }, [marketData]);

  return (
    <div className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/50 rounded-xl p-6 shadow-2xl">
            {isDegraded && (
        <div className="mb-4 bg-amber-500/20 border border-amber-500/50 rounded-lg p-3 text-amber-400 text-sm font-medium flex items-center justify-center gap-2">
          <SafeIcon name="AlertTriangle" className="w-4 h-4" />
          Telemetry Signal Degraded - Retrying...
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <SafeIcon name="TrendingUp" className="text-emerald-500" />
            Live Market Telemetry
            {(isDegraded || isCircuitBreaker || isRateLimited) && (
              <span className="ml-3 px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-[0_0_8px_rgba(245,158,11,0.2)]">
                <SafeIcon name="Server" className="w-3 h-3" />
                Cached View
              </span>
            )}
          </h2>
          <p className="text-slate-400 text-sm mt-1">Sub-10ms edge cache reads via Cloudflare KV</p>
        </div>
        <div className="flex items-center gap-2">
          {isRateLimited && (
            <div className="flex items-center gap-2 text-xs font-medium px-3 py-1 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20">
              <SafeIcon name="AlertTriangle" className="w-3 h-3" />
              Oracle Rate-Limited
            </div>
          )}
          {isStale && (
            <div className="flex items-center gap-2 text-xs font-medium px-3 py-1 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20">
              <SafeIcon name="AlertTriangle" className="w-3 h-3" />
              Telemetry Stale
            </div>
          )}
          <div className="flex items-center gap-2 text-xs font-medium px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            KV Cache: ACTIVE
          </div>
        </div>
      </div>


      {/* CFO Trend Distribution Bar */}
      <div className="mb-6 bg-zinc-900/50 rounded-lg p-3 border border-zinc-800/50">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-semibold text-slate-400">Anny CFO Trend Distribution</span>
        </div>
        <div className="w-full h-3 rounded-full flex overflow-hidden mb-2 shadow-inner bg-slate-800">
          <div
            className="h-full bg-emerald-500 hover:brightness-110 cursor-pointer transition-all border-r border-emerald-600/50"
            style={{ width: `${cfoDistribution.accumulate}%` }}
            onClick={() => setCfoFilter('Accumulate')}
            title={`Accumulate: ${cfoDistribution.accumulate}%`}
          />
          <div
            className="h-full bg-amber-500 hover:brightness-110 cursor-pointer transition-all border-r border-amber-600/50"
            style={{ width: `${cfoDistribution.wait}%` }}
            onClick={() => setCfoFilter('Wait')}
            title={`Wait: ${cfoDistribution.wait}%`}
          />
          <div
            className="h-full bg-rose-500 hover:brightness-110 cursor-pointer transition-all"
            style={{ width: `${cfoDistribution.distribute}%` }}
            onClick={() => setCfoFilter('Distribute')}
            title={`Distribute: ${cfoDistribution.distribute}%`}
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono font-bold">
          <button onClick={() => setCfoFilter('Accumulate')} className={`text-emerald-400 hover:text-emerald-300 ${cfoFilter === 'Accumulate' ? 'underline' : ''}`}>Accumulate: {cfoDistribution.accumulate}%</button>
          <button onClick={() => setCfoFilter('Wait')} className={`text-amber-400 hover:text-amber-300 ${cfoFilter === 'Wait' ? 'underline' : ''}`}>Neutral: {cfoDistribution.wait}%</button>
          <button onClick={() => setCfoFilter('Distribute')} className={`text-rose-400 hover:text-rose-300 ${cfoFilter === 'Distribute' ? 'underline' : ''}`}>Distribute: {cfoDistribution.distribute}%</button>
        </div>
      </div>

      {/* CFO Trend Filter Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0 mb-6">
        <div className="flex gap-2">
          <span className="text-slate-400 text-sm font-medium self-center mr-2">Anny CFO Trend:</span>
          {['All', 'Accumulate', 'Wait', 'Distribute'].map(filter => (
            <button
              key={filter}
              onClick={() => setCfoFilter(filter)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                cfoFilter === filter
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
                  : 'bg-zinc-800/50 text-slate-400 border-zinc-700 hover:border-slate-500'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        <div className="flex space-x-2 items-center bg-zinc-900/50 rounded-lg p-1 border border-zinc-800/50">
          <span className="text-xs text-slate-500 mr-2 ml-2">Market Polling:</span>
          {['15s', '30s', '60s', 'Paused'].map(intervalLabel => {
            const msMap = { '15s': 15000, '30s': 30000, '60s': 60000, 'Paused': null };
            const isActive = refreshIntervalMs === msMap[intervalLabel];
            return (
              <button
                key={intervalLabel}
                onClick={() => setRefreshIntervalMs(msMap[intervalLabel])}
                className={`px-3 py-1 rounded text-xs font-semibold tracking-wider transition-colors border ${
                  isActive
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-transparent text-slate-400 border-transparent hover:text-slate-300 hover:bg-zinc-800/50'
                }`}
              >
                {intervalLabel}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${isStale ? 'opacity-80 blur-[1px]' : ''}`}>
        {marketData.filter(asset => {
          if (cfoFilter === 'All') return true;
          if (!asset.cfo_state) return false;
          return asset.cfo_state.toLowerCase() === cfoFilter.toLowerCase();
        }).map((asset) => (
          <motion.div
            key={asset.symbol}
            layout
            className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50 hover:border-slate-600 transition-colors relative"
          >

            {/* Circuit Breaker Status Indicator */}
            {(isCircuitBreaker || isRateLimited) && (
              <div className="absolute top-0 right-0 -mt-3 -mr-3 z-10 px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-md text-[10px] font-bold tracking-wider uppercase shadow-[0_0_10px_rgba(245,158,11,0.2)] backdrop-blur-sm flex items-center gap-1">
                <SafeIcon name="AlertTriangle" className="w-3 h-3" />
                Circuit Open (Cached)
              </div>
            )}

            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-slate-800 rounded-md">
                  <SafeIcon name={asset.icon} className="text-slate-300 w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-white font-bold">{asset.symbol}</h3>
                  <p className="text-slate-400 text-xs">{asset.name}</p>
                </div>
              </div>
              <span className={`text-sm font-semibold flex items-center gap-1 ${asset.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {asset.change >= 0 ? '+' : ''}{asset.change.toFixed(2)}%
              </span>
            </div>
            
            <div className="mt-4">
              <motion.div 
                key={asset.price}
                initial={{ opacity: 0.5, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl font-mono font-bold text-white"
              >
                ${asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </motion.div>
            </div>
            {asset.high_24h !== undefined && asset.low_24h !== undefined && asset.high_24h > asset.low_24h && (
              <div className="mt-3 h-[2px] w-full bg-slate-700/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] transition-all duration-500"
                  style={{ width: `${Math.min(Math.max(((asset.price - asset.low_24h) / (asset.high_24h - asset.low_24h)) * 100, 0), 100)}%` }}
                />
              </div>
            )}

            {asset.cfo_state && (
              <div className="mt-3 flex justify-end">
                <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                  asset.cfo_state === 'accumulate' ? 'bg-[#3ca691]/20 text-[#3ca691] border border-[#3ca691]/30 shadow-[0_0_8px_rgba(60,166,145,0.4)]' :
                  asset.cfo_state === 'wait' ? 'bg-[#6B6588]/20 text-[#6B6588] border border-[#6B6588]/30 shadow-[0_0_8px_rgba(107,101,136,0.4)]' :
                  asset.cfo_state === 'distribute' ? 'bg-[#B767DE]/20 text-[#B767DE] border border-[#B767DE]/30 shadow-[0_0_8px_rgba(183,103,222,0.4)]' :
                  'bg-slate-700/50 text-slate-400'
                }`}>
                  {asset.cfo_state === 'accumulate' ? 'Anny CFO: Accumulate' : asset.cfo_state === 'wait' ? 'Anny CFO: Neutral' : asset.cfo_state === 'distribute' ? 'Anny CFO: Distribute' : `Anny CFO: ${asset.cfo_state}`}
                </span>
              </div>
            )}
          </motion.div>
        ))}

      {/* Anny Signal & Bot Activity Panel */}
      <div className="mt-8 border border-zinc-800/50 rounded-xl bg-black/40 backdrop-blur-md overflow-hidden shadow-xl">
        <div
          className="p-4 bg-zinc-900/60 flex items-center justify-between cursor-pointer hover:bg-zinc-800/60 transition-colors border-b border-zinc-800/50"
          onClick={() => setIsSignalsExpanded(!isSignalsExpanded)}
        >
          <div className="flex items-center gap-3">
             <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
               <SafeIcon name="Activity" className="w-5 h-5 text-indigo-400" />
             </div>
             <div>
               <h3 className="text-white font-semibold flex items-center gap-2">Live Anny Signal Activity</h3>
               <p className="text-xs text-slate-400">Recent webhooks & bot trade events</p>
             </div>
          </div>
          <SafeIcon name={isSignalsExpanded ? "ChevronUp" : "ChevronDown"} className="w-5 h-5 text-slate-400" />
        </div>

        {isSignalsExpanded && (
          <div className="p-4 space-y-3">
            {annySignals.length === 0 ? (
               <div className="text-center py-6 text-slate-500 text-sm">No recent signals logged in KV.</div>
            ) : (
               annySignals.map((signal, idx) => {
                 const isPositive = ['buy', 'long', 'take_profit', 'tp', 'take-profit'].includes((signal.action || '').toLowerCase());
                 const isNegative = ['sell', 'short', 'stop_loss', 'sl', 'stop-loss'].includes((signal.action || '').toLowerCase());
                 const badgeColor = isPositive ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                                   isNegative ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' :
                                   'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';

                 return (
                   <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30 hover:border-zinc-600/50 transition-colors">
                     <div className="flex items-center gap-4 mb-2 sm:mb-0">
                       <span className={`text-xs font-bold px-2.5 py-1 rounded-md border ${badgeColor}`}>
                         {(signal.action || 'UNKNOWN').toUpperCase()}
                       </span>
                       <span className="text-white font-semibold">{signal.symbol || 'N/A'}</span>
                       <span className="text-slate-400 font-mono text-sm">@ ${(signal.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                     </div>
                     <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>Bot #{signal.bot_id || 'N/A'}</span>
                        <span className="flex items-center gap-1">
                          <SafeIcon name="Clock" className="w-3 h-3" />
                          {new Date(signal.timestamp || Date.now()).toLocaleTimeString()}
                        </span>
                     </div>
                   </div>
                 );
               })
            )}
          </div>
        )}
      </div>

</div>
    </div>
  );
}