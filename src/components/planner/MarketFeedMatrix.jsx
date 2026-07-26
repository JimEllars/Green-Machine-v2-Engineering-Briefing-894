import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '../../common/SafeIcon';
import { getWorkerUrl } from '../../utils/workerUrl';

export default function MarketFeedMatrix() {
  const [marketData, setMarketData] = useState([]);
  const [isStale, setIsStale] = useState(false);
  const [isDegraded, setIsDegraded] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [cfoFilter, setCfoFilter] = useState('All');


  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        // Calling Cloudflare Worker Endpoint
        const workerUrl = getWorkerUrl();
        const response = await fetch(`${workerUrl}/api/market-cache`, {
          headers: {
            'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY
          }
        });
        
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
    const interval = setInterval(fetchMarketData, 30000); // 30s interval for TTL

    return () => clearInterval(interval);
  }, []);


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

      {/* CFO Trend Filter Toolbar */}
      <div className="flex gap-2 mb-6">
        <span className="text-slate-400 text-sm font-medium self-center mr-2">CFO Trend:</span>
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

      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${isStale ? 'opacity-80 blur-[1px]' : ''}`}>
        {marketData.filter(asset => {
          if (cfoFilter === 'All') return true;
          if (!asset.cfo_state) return false;
          return asset.cfo_state.toLowerCase() === cfoFilter.toLowerCase();
        }).map((asset) => (
          <motion.div
            key={asset.symbol}
            layout
            className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50 hover:border-slate-600 transition-colors"
          >
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
                  CFO: {asset.cfo_state === 'accumulate' ? 'Accumulate' : asset.cfo_state === 'wait' ? 'Neutral' : asset.cfo_state === 'distribute' ? 'Distribute' : asset.cfo_state}
                </span>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}