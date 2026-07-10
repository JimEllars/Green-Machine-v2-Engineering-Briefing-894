import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '../../common/SafeIcon';
import { supabase } from '../../supabaseClient';
import { formatDistanceToNow } from 'date-fns';



export default function AffiliatePayoutGrid() {
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    const fetchInitialData = async () => {
      const { data, error } = await supabase
        .from('blockchain_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (data) {
        setTransactions(data.map(mapTransaction));
      }
    };

    fetchInitialData();

    const channel = supabase
      .channel('ledger-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blockchain_transactions' }, (payload) => {
        setTransactions(prev => {
          if (payload.eventType === 'INSERT') {
            return [mapTransaction(payload.new), ...prev].slice(0, 10);
          }
          if (payload.eventType === 'UPDATE') {
             return prev.map(tx => tx.id === payload.new.id ? mapTransaction(payload.new) : tx);
          }
          return prev;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const mapTransaction = (dbTx) => ({
    id: dbTx.id,
    partner: dbTx.partner_id ? `AXM-${dbTx.partner_id.substring(0,3)}` : 'Unknown', // mocking partner ID format
    wallet: `${dbTx.wallet_address.substring(0, 5)}...${dbTx.wallet_address.substring(dbTx.wallet_address.length - 3)}`,
    amount: Number(dbTx.amount),
    currency: dbTx.currency,
    status: dbTx.status,
    time: formatDistanceToNow(new Date(dbTx.updated_at || dbTx.created_at || Date.now()), { addSuffix: true })
  });

  const getStatusConfig = (status) => {
    switch(status) {
      case 'minted': return { color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20', icon: 'CheckCircle' };
      case 'pending': return { color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', icon: 'Clock' };
      case 'failed': return { color: 'text-rose-400', bg: 'bg-rose-400/10', border: 'border-rose-400/20', icon: 'XCircle' };
      default: return { color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/20', icon: 'HelpCircle' };
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col h-full">
      <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <SafeIcon name="Layers" className="text-emerald-500" />
            Thirdweb Ledger Sync
          </h2>
          <p className="text-slate-400 text-sm mt-1">Real-time smart contract settlements</p>
        </div>
        <button className="text-sm px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-700 transition-colors flex items-center gap-2">
          <SafeIcon name="Download" /> Export CSV
        </button>
      </div>

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-800/50 text-slate-400">
            <tr>
              <th className="px-6 py-4 font-medium">Partner ID</th>
              <th className="px-6 py-4 font-medium">Wallet Destination</th>
              <th className="px-6 py-4 font-medium">Amount</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            <AnimatePresence>
              {transactions.map((tx) => {
                const config = getStatusConfig(tx.status);
                return (
                  <motion.tr 
                    key={tx.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      backgroundColor: tx.status === 'minted' ? ['rgba(16, 185, 129, 0.4)', 'rgba(30, 41, 59, 0)'] : 'rgba(30, 41, 59, 0)'
                    }}
                    transition={{ duration: 0.5 }}
                    className="hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-6 py-4 font-mono text-emerald-400">{tx.partner}</td>
                    <td className="px-6 py-4 font-mono text-slate-300">{tx.wallet}</td>
                    <td className="px-6 py-4 font-semibold text-white">
                      ${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-slate-500 font-normal">{tx.currency}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${config.bg} ${config.color} ${config.border}`}>
                        <SafeIcon name={config.icon} className="w-3.5 h-3.5" />
                        {tx.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-slate-400">{tx.time}</td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );
}