import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '../../common/SafeIcon';

const MOCK_TRANSACTIONS = [
  { id: 'tx_1', partner: 'AXM-992', wallet: '0x71C...3A9', amount: 1250.00, currency: 'USDC', status: 'minted', time: '2m ago' },
  { id: 'tx_2', partner: 'AXM-441', wallet: '0x99B...1F2', amount: 850.50, currency: 'USDT', status: 'pending', time: 'Just now' },
  { id: 'tx_3', partner: 'AXM-105', wallet: '0x33A...8C4', amount: 3200.00, currency: 'USDC', status: 'minted', time: '15m ago' },
  { id: 'tx_4', partner: 'AXM-882', wallet: '0x55D...9E1', amount: 450.00, currency: 'DAI', status: 'failed', time: '1h ago' },
];

export default function AffiliatePayoutGrid() {
  const [transactions, setTransactions] = useState(MOCK_TRANSACTIONS);

  // Simulate WebSocket settlement updates
  useEffect(() => {
    const timer = setTimeout(() => {
      setTransactions(prev => prev.map(tx => 
        tx.id === 'tx_2' ? { ...tx, status: 'minted', time: 'Just now' } : tx
      ));
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

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
                    animate={{ opacity: 1, y: 0 }}
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