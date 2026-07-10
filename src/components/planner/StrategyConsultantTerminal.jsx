import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '../../common/SafeIcon';
import { supabase } from '../../supabaseClient';



export default function StrategyConsultantTerminal() {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [strategy, setStrategy] = useState('');
  const [provider, setProvider] = useState('{provider}'); // Default

  useEffect(() => {
    const fetchLatestStrategy = async () => {
      const { data, error } = await supabase
        .from('financial_recommendations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setStrategy(data.strategy_payload || '');
        if (data.provider_used) {
           setProvider(data.provider_used.toUpperCase());
        }
      }
    };

    fetchLatestStrategy();

    const channel = supabase
      .channel('strategy-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'financial_recommendations' }, (payload) => {
        setStrategy(payload.new.strategy_payload || '');
        if (payload.new.provider_used) {
           setProvider(payload.new.provider_used.toUpperCase());
        }
        setDisplayText(''); // Reset typing
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // Typewriter effect for the terminal
  useEffect(() => {
    if (!strategy) return;

    setIsTyping(true);
    let i = 0;
    const interval = setInterval(() => {
      setDisplayText(strategy.slice(0, i));
      i++;
      if (i > strategy.length) {
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
            <div className="w-3 h-3 rounded-full bg-rose-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
          </div>
          <span className="text-xs font-mono text-slate-400 flex items-center gap-2">
            <SafeIcon name="Cpu" className="w-3 h-3" />
            Onyx Cognitive Engine // llm-proxy
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">
            <SafeIcon name="Shield" className="w-3 h-3" />
            DeepSeek-V3
          </span>
        </div>
      </div>

      {/* Terminal Body */}
      <div className="p-6 flex-1 overflow-y-auto font-mono text-sm leading-relaxed">
        <div className="text-emerald-500/50 mb-4 select-none">
          {'>'} Initializing weekly financial audit cron...<br/>
          {'>'} Connecting to public.blockchain_transactions... OK<br/>
          {'>'} Fetching MARKET_CACHE from Edge... OK<br/>
          {'>'} Routing context to DeepSeek proxy... <span className="text-emerald-400 animate-pulse">AWAITING RESPONSE</span>
        </div>
        
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