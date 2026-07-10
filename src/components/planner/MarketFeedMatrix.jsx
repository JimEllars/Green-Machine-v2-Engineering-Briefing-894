import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '../../common/SafeIcon';

const INITIAL_MARKET_DATA = [
  { symbol: 'BTC', name: 'Bitcoin', price: 64230.50, change: 2.4, type: 'crypto', icon: 'DollarSign' },
  { symbol: 'ETH', name: 'Ethereum', price: 3450.20, change: -1.2, type: 'crypto', icon: 'Activity' },
  { symbol: 'SOL', name: 'Solana', price: 145.80, change: 5.6, type: 'crypto', icon: 'Zap' },
  { symbol: 'AAPL', name: 'Apple Inc.', price: 189.45, change: 0.8, type: 'equity', icon: 'Briefcase' },
  { symbol: 'MSFT', name: 'Microsoft', price: 420.15, change: 1.1, type: 'equity', icon: 'Monitor' },
  { symbol: 'NVDA', name: 'NVIDIA', price: 850.30, change: -3.4, type: 'equity', icon: 'Cpu' },
];

export default function MarketFeedMatrix() {
  const [marketData, setMarketData] = useState(INITIAL_MARKET_DATA);


  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        // Calling Cloudflare Worker Endpoint
        const response = await fetch('/api/market-cache', {
          headers: {
            'X-Axim-Signature': 'axim_internal_finance' // Using the mock internal key shown in App.jsx
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          // Transform edge data to UI format
          if (data && data.crypto && data.equities) {
             const formattedData = [
              { symbol: 'BTC', name: 'Bitcoin', price: data.crypto.BTC.price, change: data.crypto.BTC.change_24h, type: 'crypto', icon: 'DollarSign' },
              { symbol: 'ETH', name: 'Ethereum', price: data.crypto.ETH.price, change: data.crypto.ETH.change_24h, type: 'crypto', icon: 'Activity' },
              { symbol: 'SOL', name: 'Solana', price: data.crypto.SOL.price, change: data.crypto.SOL.change_24h, type: 'crypto', icon: 'Zap' },
              { symbol: 'AAPL', name: 'Apple Inc.', price: data.equities.AAPL.price, change: data.equities.AAPL.change_24h, type: 'equity', icon: 'Briefcase' },
              { symbol: 'MSFT', name: 'Microsoft', price: data.equities.MSFT.price, change: data.equities.MSFT.change_24h, type: 'equity', icon: 'Monitor' },
              // Fallback NVDA as it wasn't in mock response
              { symbol: 'NVDA', name: 'NVIDIA', price: 850.30, change: -3.4, type: 'equity', icon: 'Cpu' },
            ];
            setMarketData(formattedData);
          }
        }
      } catch (error) {
        console.error("Failed to fetch market data", error);
      }
    };

    fetchMarketData(); // initial fetch
    const interval = setInterval(fetchMarketData, 30000); // 30s interval for TTL

    return () => clearInterval(interval);
  }, []);


  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <SafeIcon name="TrendingUp" className="text-emerald-500" />
            Live Market Telemetry
          </h2>
          <p className="text-slate-400 text-sm mt-1">Sub-10ms edge cache reads via Cloudflare KV</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          KV Cache: ACTIVE
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {marketData.map((asset) => (
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
          </motion.div>
        ))}
      </div>
    </div>
  );
}