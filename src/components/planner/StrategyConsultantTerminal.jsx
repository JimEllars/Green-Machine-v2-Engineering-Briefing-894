import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '../../common/SafeIcon';
import { supabase } from '../../supabaseClient';



export default function StrategyConsultantTerminal() {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [strategy, setStrategy] = useState('');
  const [provider, setProvider] = useState('{provider}'); // Default

  const [connectionStatus, setConnectionStatus] = useState('CONNECTING');
  const [isJsonValid, setIsJsonValid] = useState(false);
  const [parsedStrategyData, setParsedStrategyData] = useState(null);

  useEffect(() => {
    let channel;
    let retryTimeout;
    let retryCount = 0;
    const maxBackoff = 30000;

    const fetchLatestStrategy = async () => {
      const { data, error } = await supabase
        .from('financial_recommendations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        let payload = data.strategy_payload || '';
        try {
           const parsed = JSON.parse(payload);
           setIsJsonValid(true);
           setParsedStrategyData(parsed);
           // Pretty print JSON for the terminal if valid
           payload = JSON.stringify(parsed, null, 2);
        } catch (e) {
           setIsJsonValid(false);
           setParsedStrategyData(null);
           // Fallback to text formatting as markdown-ish (preserving formatting but ensuring it's text)
           payload = `# Recommendation Payload (Raw)\n\n` + payload;
        }
        setStrategy(payload);
        if (data.provider_used) {
           setProvider(data.provider_used.toUpperCase());
        }
      }
    };

    const subscribeToChanges = () => {
      if (channel) {
        supabase.removeChannel(channel);
      }

      setConnectionStatus('CONNECTING');

      channel = supabase
        .channel('strategy-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'financial_recommendations' }, (payload) => {
          let newPayload = payload.new.strategy_payload || '';
          try {
             const parsed = JSON.parse(newPayload);
             setIsJsonValid(true);
             setParsedStrategyData(parsed);
             newPayload = JSON.stringify(parsed, null, 2);
          } catch (e) {
             setIsJsonValid(false);
             setParsedStrategyData(null);
             newPayload = `# Recommendation Payload (Raw)\n\n` + newPayload;
          }
          setStrategy(prev => prev + '\n\n' + newPayload);
          if (payload.new.provider_used) {
             setProvider(payload.new.provider_used.toUpperCase());
          }
        })
        .subscribe((status) => {
          setConnectionStatus(status);

          if (status === 'SUBSCRIBED') {
            retryCount = 0;
          } else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            const delay = Math.min(1000 * Math.pow(2, retryCount), maxBackoff);
            retryCount++;
            clearTimeout(retryTimeout);
            retryTimeout = setTimeout(() => {
              subscribeToChanges();
            }, delay);
          }
        });
    };

    fetchLatestStrategy();
    subscribeToChanges();

    return () => {
      clearTimeout(retryTimeout);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const typedLengthRef = useRef(0);

  // Typewriter effect for the terminal
  useEffect(() => {
    if (!strategy || strategy.length <= typedLengthRef.current) {
      setIsTyping(false);
      return;
    }

    setIsTyping(true);
    const interval = setInterval(() => {
      typedLengthRef.current++;
      setDisplayText(strategy.slice(0, typedLengthRef.current));

      if (typedLengthRef.current >= strategy.length) {
        clearInterval(interval);
        setIsTyping(false);
      }
    }, 15);
    return () => clearInterval(interval);
  }, [strategy]);

  return (
    <div className="bg-[#0A0F15] border border-slate-800 rounded-xl flex flex-col h-full shadow-2xl overflow-hidden relative">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div
              className={`w-3 h-3 rounded-full ${
                connectionStatus === 'SUBSCRIBED' ? 'bg-emerald-500/80' :
                connectionStatus === 'CONNECTING' ? 'bg-amber-500/80 animate-pulse' :
                'bg-rose-500/80'
              }`}
              title={`Connection Status: ${connectionStatus}`}
            ></div>
            <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
          </div>
          <span className="text-xs font-mono text-slate-400 flex items-center gap-2">
            <SafeIcon name="Cpu" className="w-3 h-3" />
            Onyx Cognitive Engine // llm-proxy
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded border ${isJsonValid ? 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-700 cursor-pointer' : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'}`}
            disabled={!isJsonValid}
            onClick={() => {
               if (isJsonValid && parsedStrategyData) {
                  navigator.clipboard.writeText(JSON.stringify(parsedStrategyData, null, 2));
               }
            }}
          >
            <SafeIcon name="Copy" className="w-3 h-3" />
            Copy Recommendations JSON
          </button>
          <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">
            <SafeIcon name="Shield" className="w-3 h-3" />
            {provider !== '{provider}' ? provider : 'DeepSeek-V3'}
          </span>
        </div>
      </div>

      {/* Terminal Body */}
      <div className="p-6 flex-1 overflow-y-auto font-mono text-sm leading-relaxed relative">
        <div className="text-emerald-500/50 mb-4 select-none">
          {'>'} Initializing weekly financial audit cron...<br/>
          {'>'} Connecting to public.blockchain_transactions... OK<br/>
          {'>'} Fetching MARKET_CACHE from Edge... OK<br/>
          {'>'} Routing context to DeepSeek proxy... <span className="text-emerald-400 animate-pulse">AWAITING RESPONSE</span>
        </div>
        
        {parsedStrategyData && parsedStrategyData._node_health_index !== undefined && (
           <div className="absolute top-6 right-6">
              <div className="bg-slate-900/80 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)] rounded-lg p-3 flex flex-col items-end backdrop-blur-sm">
                 <span className="text-[10px] uppercase text-emerald-500/80 tracking-wider font-bold mb-1">Node Health Index</span>
                 <span className="text-2xl font-bold text-emerald-400">{Number(parsedStrategyData._node_health_index).toFixed(2)}</span>
              </div>
           </div>
        )}

        <div className="text-slate-300 whitespace-pre-wrap">
          {displayText}
          {isTyping && <span className="inline-block w-2 h-4 bg-emerald-500 ml-1 animate-pulse" />}
        </div>
      </div>

      {/* Glow effect */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>
    </div>
  );
}