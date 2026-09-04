import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { ShieldCheckIcon, BanknotesIcon, ArrowTrendingUpIcon } from '@heroicons/react/24/outline';

const TradeExecutionLedger = () => {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrades = async () => {
      try {
        const { data, error } = await supabase
          .from('blockchain_transactions')
          .select('*')
          .eq('partner_id', 'anny_ai_system')
          .order('created_at', { ascending: false })
          .limit(20);

        if (error) throw error;
        setTrades(data || []);
      } catch (err) {
        console.error("Error fetching execution ledger:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchTrades();

    // Set up real-time subscription
    const subscription = supabase
      .channel('public:blockchain_transactions')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'blockchain_transactions',
          filter: "partner_id=eq.anny_ai_system"
        },        (payload) => {
          setTrades((current) => {
            const exists = current.find(t => t.id === payload.new.id);
            if (exists) return current;

            // Trigger Service Worker Notification if action is "executed"
            if (payload.new.status === 'executed' || payload.new.action === 'executed') {
              if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(registration => {
                  const symbol = payload.new.currency || payload.new.smart_contract_address || 'ASSET';
                  registration.showNotification("Green Machine Alert", {
                    body: "Trade Executed: " + symbol,
                    icon: "/icon.png"
                  });
                });
              }
            }

            return [payload.new, ...current].slice(0, 20);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);


  const stats = useMemo(() => {
    const totalTrades = trades.length;
    let winningTrades = 0;
    let totalVolume = 0;

    trades.forEach(trade => {
      const confidence = trade.metadata?.probability_of_profit || 0;
      const isExecuted = trade.status ? trade.status === 'executed' : true;
      if (confidence > 90 && isExecuted) {
        winningTrades++;
      }
      totalVolume += Number(trade.amount || 0);
    });

    const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : 0;

    return { totalTrades, winRate, totalVolume };
  }, [trades]);

  const recentTradesForChart = useMemo(() => {
    return [...trades].slice(0, 15).reverse();
  }, [trades]);

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800/50 backdrop-blur-xl rounded-2xl p-6 shadow-2xl flex flex-col h-full relative overflow-hidden transition-all hover:border-emerald-500/30">

      {/* Header Section */}
      <div className="flex items-center justify-between mb-6 z-10 relative">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <BanknotesIcon className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
              AI Execution Ledger
            </h2>
            <p className="text-xs text-zinc-400">Live Capital Deployment Records</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-700/50">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          SYNC: LIVE
        </div>
      </div>

            {/* Treasury Overview Section */}
      <div className="grid grid-cols-3 gap-4 mb-6 z-10 relative">
        <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4 flex flex-col justify-center items-center backdrop-blur-sm">
          <p className="text-xs text-zinc-400 mb-1 uppercase tracking-wider">Total Trades</p>
          <p className="text-2xl font-bold text-zinc-100">{stats.totalTrades}</p>
        </div>
        <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4 flex flex-col justify-center items-center backdrop-blur-sm">
          <p className="text-xs text-zinc-400 mb-1 uppercase tracking-wider">Win Rate</p>
          <p className="text-2xl font-bold text-emerald-400">{stats.winRate}%</p>
        </div>
        <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4 flex flex-col justify-center items-center backdrop-blur-sm">
          <p className="text-xs text-zinc-400 mb-1 uppercase tracking-wider">Total Volume</p>
          <p className="text-2xl font-bold text-zinc-100 font-mono">${stats.totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Trajectory Chart Section */}
      <div className="mb-6 z-10 relative">
        <p className="text-xs text-zinc-400 mb-2 uppercase tracking-wider">Trajectory Chart</p>
        <div className="flex items-end h-24 gap-1 w-full bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-2">
          {recentTradesForChart.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs">Awaiting data...</div>
          ) : (
            recentTradesForChart.map((trade, idx) => {
              const isBuy = trade.smart_contract_address?.toLowerCase() === 'buy';
              const maxAmount = Math.max(...recentTradesForChart.map(t => Number(t.amount || 0)), 1);
              const amount = Number(trade.amount || 0);
              const heightPercent = Math.max((amount / maxAmount) * 100, 5); // Minimum 5% height

              return (
                <div
                  key={trade.id || idx}
                  className="flex-1 flex flex-col justify-end group/bar relative"
                >
                  <div
                    className={`w-full rounded-t-sm transition-all duration-300 hover:brightness-110 ${isBuy ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                    style={{ height: `${heightPercent}%` }}
                  ></div>

                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover/bar:opacity-100 bg-zinc-800 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap z-50 transition-opacity">
                    {isBuy ? 'BUY' : 'SELL'}: ${amount.toFixed(2)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Table Section */}
      <div className="flex-grow overflow-x-auto relative z-10 rounded-xl border border-zinc-800/60 bg-zinc-900/40">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-zinc-800/80 sticky top-0 text-zinc-300 font-medium text-xs uppercase tracking-wider backdrop-blur-md">
            <tr>
              <th className="px-4 py-3 border-b border-zinc-700/50">Date</th>
              <th className="px-4 py-3 border-b border-zinc-700/50">Asset</th>
              <th className="px-4 py-3 border-b border-zinc-700/50">Action</th>
              <th className="px-4 py-3 border-b border-zinc-700/50 text-right">Executed ($)</th>
              <th className="px-4 py-3 border-b border-zinc-700/50 text-right">AI Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
            {loading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-4 py-4"><div className="h-4 bg-zinc-800 rounded w-24"></div></td>
                  <td className="px-4 py-4"><div className="h-4 bg-zinc-800 rounded w-16"></div></td>
                  <td className="px-4 py-4"><div className="h-4 bg-zinc-800 rounded w-12"></div></td>
                  <td className="px-4 py-4"><div className="h-4 bg-zinc-800 rounded w-16 ml-auto"></div></td>
                  <td className="px-4 py-4"><div className="h-4 bg-zinc-800 rounded w-12 ml-auto"></div></td>
                  <td className="px-4 py-4"><div className="h-4 bg-zinc-800 rounded w-16 ml-auto"></div></td>
                </tr>
              ))
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-4 py-12 text-center text-zinc-500 text-sm">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <ShieldCheckIcon className="h-8 w-8 text-zinc-600 mb-2" />
                    <p>No recent AI executions found.</p>
                    <p className="text-xs text-zinc-600">Awaiting optimal market conditions.</p>
                  </div>
                </td>
              </tr>
            ) : (
              trades.map((trade) => {
                const isBuy = trade.smart_contract_address?.toLowerCase() === 'buy';
                const confidence = trade.metadata?.probability_of_profit || 0;

                return (
                  <tr
                    key={trade.id || Math.random()}
                    className="hover:bg-zinc-800/30 transition-colors group"
                  >
                    <td className="px-4 py-3 text-zinc-400 font-mono text-xs">
                      {formatDate(trade.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200 font-medium">
                        {trade.currency || 'UNKNOWN'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                        isBuy
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {isBuy ? <ArrowTrendingUpIcon className="h-3 w-3" /> : null}
                        {(trade.smart_contract_address || 'UNKNOWN').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-200">
                      ${Number(trade.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                        confidence >= 90 ? 'text-emerald-400' : 'text-zinc-400'
                      }`}>
                        {confidence}%
                        <ShieldCheckIcon className="h-3.5 w-3.5" />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {trade.transaction_hash ? (
                        <div className="flex flex-col items-end gap-1">
                          <a
                            href={`https://arbiscan.io/tx/${trade.transaction_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-mono text-xs underline"
                          >
                            [Tx: {trade.transaction_hash.substring(0, 6)}...{trade.transaction_hash.substring(trade.transaction_hash.length - 4)}]
                          </a>
                          {trade.status === 'confirmed' ? (
                             <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded animate-pulse">
                               <SafeIcon name="CheckCircle" className="w-3 h-3" /> Confirmed
                             </span>
                          ) : (
                             <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                               <SafeIcon name="Clock" className="w-3 h-3" /> {trade.status || 'Submitted'}
                             </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-600 font-mono text-xs">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TradeExecutionLedger;
