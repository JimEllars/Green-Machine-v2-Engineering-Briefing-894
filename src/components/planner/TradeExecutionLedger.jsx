import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { ShieldCheckIcon, BanknotesIcon, ArrowTrendingUpIcon } from '@heroicons/react/24/outline';
import SafeIcon from '../../common/SafeIcon';
import { getWorkerUrl } from '../../utils/workerUrl';


const TradeExecutionLedger = () => {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleOpenModal = (trade) => {
    setSelectedTrade(trade);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setSelectedTrade(null);
    setIsModalOpen(false);
  };

  const handleHITLAction = async (actionType) => {
    if (!selectedTrade) return;
    setIsExecuting(true);
    try {
      const token = selectedTrade.metadata?.approval_token; // Assume token is stored in metadata
      if (!token) {
         console.error("Missing HITL approval token in trade metadata");
         return;
      }

      const endpoint = actionType === 'approve' ? '/api/admin/hitl-approve' : '/api/admin/hitl-reject';
      const url = `${getWorkerUrl()}${endpoint}?token=${encodeURIComponent(token)}`;

      const response = await fetch(url, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to ${actionType} trade`);
      }

      // Success - close modal (real-time subscription will update the list)
      handleCloseModal();
    } catch (err) {
      console.error(`Error during ${actionType}:`, err);
    } finally {
      setIsExecuting(false);
    }
  };

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
    <div className="border border-slate-800 bg-slate-900/60 backdrop-blur-md rounded-xl p-6 shadow-2xl flex flex-col h-full relative overflow-hidden transition-all hover:border-emerald-500/30">

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
        <div className="flex items-center gap-2 text-xs text-zinc-400 tabular-nums font-mono transition-colors duration-300 bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-700/50">
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
          <p className="text-2xl font-bold text-zinc-100 tabular-nums font-mono transition-colors duration-300">${stats.totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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
                    className={`hover:bg-zinc-800/30 transition-colors group ${trade.status === 'AWAITING_MULTISIG_APPROVAL' ? 'bg-amber-500/5' : ''}`}
                  >
                    <td className="px-4 py-3 text-zinc-400 tabular-nums font-mono transition-colors duration-300 text-xs">
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
                    <td className="px-4 py-3 text-right tabular-nums font-mono transition-colors duration-300 text-zinc-200">
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
                      {trade.status === 'AWAITING_MULTISIG_APPROVAL' ? (
                        <div className="flex flex-col items-end gap-1">
                          <button
                            onClick={() => handleOpenModal(trade)}
                            className="flex items-center gap-1 text-[10px] uppercase font-bold text-amber-400 bg-amber-500/20 hover:bg-amber-500/30 px-2 py-1 rounded border border-amber-500/30 transition-colors"
                          >
                            <ShieldCheckIcon className="w-3 h-3" /> Review
                          </button>
                        </div>
                      ) : trade.status === 'rejected' ? (
                        <div className="flex flex-col items-end gap-1">
                           <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                             <SafeIcon name="XCircle" className="w-3 h-3" /> Rejected
                           </span>
                        </div>
                      ) : trade.transaction_hash ? (
                        <div className="flex flex-col items-end gap-1">
                          <a
                            href={`https://arbiscan.io/tx/${trade.transaction_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 tabular-nums font-mono transition-colors duration-300 text-xs underline"
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
                        <span className="text-zinc-600 tabular-nums font-mono transition-colors duration-300 text-xs">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* HITL Approval Modal */}
      {isModalOpen && selectedTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                <ShieldCheckIcon className="w-5 h-5 text-amber-400" />
                Human-in-the-Loop Review
              </h3>
              <button onClick={handleCloseModal} className="text-zinc-500 hover:text-zinc-300">
                &times;
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-zinc-400">
                The AI system has proposed a trade that requires multi-sig human approval.
              </p>

              <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-xs text-zinc-500">Asset</span>
                  <span className="text-sm font-medium text-zinc-200">{selectedTrade.currency || 'UNKNOWN'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-zinc-500">Action</span>
                  <span className={`text-sm font-semibold ${selectedTrade.smart_contract_address?.toLowerCase() === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(selectedTrade.smart_contract_address || 'UNKNOWN').toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-zinc-500">Amount</span>
                  <span className="text-sm tabular-nums font-mono transition-colors duration-300 text-zinc-200">${Number(selectedTrade.amount || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-zinc-500">AI Confidence</span>
                  <span className="text-sm font-medium text-zinc-200">{selectedTrade.metadata?.probability_of_profit || 0}%</span>
                </div>
              </div>
            </div>

            <div className="p-5 bg-zinc-900/80 border-t border-zinc-800 flex gap-3">
              <button
                onClick={() => handleHITLAction('reject')}
                disabled={isExecuting}
                className="flex-1 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {isExecuting ? 'Processing...' : 'Reject Trade'}
              </button>
              <button
                onClick={() => handleHITLAction('approve')}
                disabled={isExecuting}
                className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {isExecuting ? 'Processing...' : 'Approve Execution'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradeExecutionLedger;
