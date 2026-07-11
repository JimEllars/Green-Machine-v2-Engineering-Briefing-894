import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import SafeIcon from '../../common/SafeIcon';

const SystemDiagnosticsPanel = ({ dlqStatus, onDiagnosticsUpdate }) => {
  const [txCount, setTxCount] = useState(0);
  const [dbConnected, setDbConnected] = useState(true);
  const [edgeCacheAvailable, setEdgeCacheAvailable] = useState(true);
  const [edgeLatency, setEdgeLatency] = useState(0);
  const [edgeJitter, setEdgeJitter] = useState(0);
  const prevLatencyRef = useRef(0);
  const [tickerStream, setTickerStream] = useState([]);

  const streamEndRef = useRef(null);
  const activeChannelRef = useRef(null);

  const checkEdgeHealth = async () => {
    try {
      const workerUrl = import.meta.env.VITE_WORKER_URL || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.')) ? 'http://localhost:8787' : window.location.origin);
      const start = performance.now();
      const res = await fetch(`${workerUrl}/api/market-cache`, {
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      const end = performance.now();
      const currentLatency = Math.round(end - start);
      setEdgeJitter(Math.abs(currentLatency - prevLatencyRef.current));
      prevLatencyRef.current = currentLatency;
      setEdgeLatency(currentLatency);
      setEdgeCacheAvailable(res.ok);
      if (onDiagnosticsUpdate) onDiagnosticsUpdate({ edgeCacheAvailable: res.ok });
    } catch (e) {
      setEdgeCacheAvailable(false);
      setEdgeLatency(0);
      if (onDiagnosticsUpdate) onDiagnosticsUpdate({ edgeCacheAvailable: false });
    }

    // Check Database Node Health State
    try {
        const { error } = await supabase
          .from('blockchain_transactions')
          .select('*', { count: 'exact', head: true });

        if (error) {
            setDbConnected(false);
            if (onDiagnosticsUpdate) onDiagnosticsUpdate({ dbConnected: false });
        } else {
            setDbConnected(true);
            if (onDiagnosticsUpdate) onDiagnosticsUpdate({ dbConnected: true });
        }
    } catch (e) {
        setDbConnected(false);
        if (onDiagnosticsUpdate) onDiagnosticsUpdate({ dbConnected: false });
    }
  };

  useEffect(() => {
    checkEdgeHealth();
    const intervalId = setInterval(checkEdgeHealth, 15000);
    return () => clearInterval(intervalId);
  }, []);


  useEffect(() => {
    const initDiagnostics = async () => {
      try {
        // Setup WebSocket for realtime ticker stream FIRST
        activeChannelRef.current = supabase
          .channel('ledger-realtime')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'blockchain_transactions' }, payload => {
             const newTx = `[${new Date().toLocaleTimeString()}] ${payload.eventType.toUpperCase()} - ${payload.new?.transaction_hash?.substring(0,8) || 'Unknown'}`;
             setTickerStream(prev => [...prev, newTx].slice(-50)); // keep last 50

             // Normal operation
             if (payload.eventType === 'INSERT') {
               setTxCount(prev => prev + 1);
             } else if (payload.eventType === 'DELETE') {
               setTxCount(prev => prev - 1);
             }
          })
          .subscribe();

        // Query initial transactions count
        const { count, error } = await supabase
          .from('blockchain_transactions')
          .select('*', { count: 'exact', head: true });

        if (!error) {
          setTxCount(count || 0);
          setDbConnected(true);
        } else {
          setDbConnected(false);
        }

      } catch (e) {
        console.error("Init diagnostics failed", e);
      }
    };

    initDiagnostics();

    return () => {
      if (activeChannelRef.current) {
        supabase.removeChannel(activeChannelRef.current);
      }
    };
  }, []);

  // Auto-scroll effect
  useEffect(() => {
    if (streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [tickerStream]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 h-full flex flex-col">
      <h3 className="text-white font-bold mb-4 flex items-center gap-2 text-sm">
        <SafeIcon name="Activity" className="text-emerald-500 w-4 h-4" />
        System Diagnostics
      </h3>

      <div className="grid grid-cols-1 gap-4 flex-grow">
        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Database Node Connection</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono">{dbConnected ? 'ONLINE' : 'OFFLINE'}</span>
            <div className={`w-2 h-2 rounded-full ${dbConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          </div>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Edge Cache Availability</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono">{edgeCacheAvailable ? 'ACTIVE' : 'DEGRADED'}</span>
            <div className={`w-2 h-2 rounded-full ${edgeCacheAvailable ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          </div>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Edge Fetch Latency</span>
          <div className="flex items-center gap-3">
             <span className="text-xs font-mono text-emerald-500/80 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)] bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20" title="Edge Jitter">±{edgeJitter}ms</span>
             <span className="text-lg font-bold text-emerald-400 font-mono drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]">{edgeLatency}ms</span>
          </div>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Total Transactions</span>
          <span className="text-lg font-bold text-white">{txCount}</span>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">DLQ Depth</span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white">{dlqStatus.count}</span>
            <div className={`w-2 h-2 rounded-full ${dlqStatus.active ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
          </div>
        </div>


        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Fin-Ops Margin Ratio</span>
          <span className={`text-lg font-bold drop-shadow-md ${((txCount / (txCount + (dlqStatus?.count || 0) + 1)) * 100) >= 95 ? 'text-emerald-500' : 'text-amber-500'}`}>
            {((txCount / (txCount + (dlqStatus?.count || 0) + 1)) * 100).toFixed(1)}%
          </span>
        </div>

        <div className="mt-4 flex-grow bg-black/40 rounded-lg p-4 border border-slate-700 font-mono text-[10px] text-slate-400 overflow-y-auto">
          <div className="mb-2 text-emerald-500 font-bold uppercase tracking-wider">Live Tx Stream</div>
          <div className="max-h-[150px] overflow-y-auto">
            {tickerStream.length === 0 ? (
              <div className="text-slate-600 italic">Listening for changes...</div>
            ) : (
              tickerStream.map((msg, idx) => (
                <div key={idx} className="mb-1 truncate">{msg}</div>
              ))
            )}
            <div ref={streamEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemDiagnosticsPanel;
