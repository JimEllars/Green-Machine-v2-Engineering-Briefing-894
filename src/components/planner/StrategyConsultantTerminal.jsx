import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '../../common/SafeIcon';
import { supabase } from '../../supabaseClient';
import { getWorkerUrl } from '../../utils/workerUrl';




export default function StrategyConsultantTerminal() {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [strategy, setStrategy] = useState('');
  const [strategyHistory, setStrategyHistory] = useState([]);
  const [provider, setProvider] = useState('{provider}'); // Default

  const [connectionStatus, setConnectionStatus] = useState('CONNECTING');
  const [isJsonValid, setIsJsonValid] = useState(false);
  const [parsedStrategyData, setParsedStrategyData] = useState(null);
  const [isCopied, setIsCopied] = useState(false);
  const [exportFormat, setExportFormat] = useState(() => localStorage.getItem('terminal_export_format') || 'Markdown');
  const [promptInput, setPromptInput] = useState('');
  const [sessionId] = useState(() => Math.random().toString(36).substring(2, 15));
  const [isConsulting, setIsConsulting] = useState(false);


  useEffect(() => {
    localStorage.setItem('terminal_export_format', exportFormat);
  }, [exportFormat]);

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
        setStrategyHistory([payload]);
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
          if (typingIntervalRef.current) {
            clearInterval(typingIntervalRef.current);
          }
          typedLengthRef.current = 0;
          setDisplayText('');
          setStrategyHistory(prev => {
            const updatedHistory = [...prev, newPayload].slice(-3);
            const fullText = updatedHistory.join('\n\n');

            // Explicitly resetting the typewriter in this update block handled above.

            setStrategy(fullText);
            return updatedHistory;
          });

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
  const typingIntervalRef = useRef(null);

  const [isCopyUnavailable, setIsCopyUnavailable] = useState(false);

  const handleConsultSubmit = async (e) => {
    e.preventDefault();
    if (!promptInput.trim()) return;

    setIsConsulting(true);
    setDisplayText('');
    setIsTyping(true);

    // Clear typing intervals when starting a new generation
    if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
    }
    typedLengthRef.current = 0;

    // Simulate "Routing context to DeepSeek proxy..." equivalent text
    const initText = "> Initializing consultant session...\n> Routing prompt to Edge AI (Llama 3.1 8B)...\n> AWAITING RESPONSE\n\n";
    setDisplayText(initText);

    try {
      const response = await fetch(`${getWorkerUrl()}/api/strategy-consult`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        },
        body: JSON.stringify({
          prompt: promptInput,
          session_id: sessionId
        })
      });

      const data = await response.json();

      if (data.success && data.data) {
        setIsJsonValid(true);
        setParsedStrategyData(data.data);
        const payload = JSON.stringify(data.data, null, 2);
        setStrategy(payload);
        setStrategyHistory(prev => [...prev, payload].slice(-3));
        setProvider('EDGE-LLAMA-3.1-8B');
      } else {
        setIsJsonValid(false);
        setParsedStrategyData(null);
        setStrategy("Error: " + (data.error || "Unknown error during AI consultation."));
      }
    } catch (err) {
      setIsJsonValid(false);
      setParsedStrategyData(null);
      setStrategy("Error: " + err.message);
    } finally {
      setIsConsulting(false);
      setPromptInput('');
    }
  };


  // Handles copying the recommendation strategy to the clipboard
  // Supports switching between Markdown and JSON formats with defensive fallbacks
  const handleCopyPlan = async () => {
    if (!strategy) return;
    try {
      let textToCopy = strategy || '';
      // If JSON is selected, format the underlying recommendation payload using JSON.stringify
      if (exportFormat === 'JSON' && isJsonValid && parsedStrategyData) {
        textToCopy = JSON.stringify(parsedStrategyData, null, 2) || '';
      }

      if (!textToCopy) return; // Defensive fallback if stringification fails

      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy plan: Clipboard access denied or unavailable', err);
      setIsCopyUnavailable(true);
      setTimeout(() => setIsCopyUnavailable(false), 3000);
    }
  };

  // Typewriter effect for the terminal
  useEffect(() => {
    if (!strategy || strategy.length <= typedLengthRef.current) {
      setIsTyping(false);
      return;
    }

    setIsTyping(true);
    typingIntervalRef.current = setInterval(() => {
      typedLengthRef.current++;
      setDisplayText(strategy.slice(0, typedLengthRef.current));

      if (typedLengthRef.current >= strategy.length) {
        clearInterval(typingIntervalRef.current);
        setIsTyping(false);
      }
    }, 15);
    return () => clearInterval(typingIntervalRef.current);
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
            className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded border ${strategy ? (isCopyUnavailable ? 'bg-amber-900/50 text-amber-400 border-amber-700' : 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-700 cursor-pointer') : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'}`}
            disabled={!strategy || isCopyUnavailable}
            onClick={handleCopyPlan}
          >
            <SafeIcon name={isCopied ? "CheckCircle" : (isCopyUnavailable ? "AlertTriangle" : "Copy")} className="w-3 h-3" />
            {isCopyUnavailable ? "Copy Unavailable" : isCopied ? "Copied!" : "Copy Plan"}
          </button>
          <div className="flex bg-slate-800 rounded border border-slate-700 overflow-hidden">
            <button
              onClick={() => setExportFormat('Markdown')}
              className={`px-2 py-1 text-xs font-medium transition-colors ${exportFormat === 'Markdown' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
            >
              Markdown
            </button>
            <button
              onClick={() => setExportFormat('JSON')}
              disabled={!isJsonValid}
              className={`px-2 py-1 text-xs font-medium transition-colors ${exportFormat === 'JSON' ? 'bg-slate-700 text-white' : !isJsonValid ? 'text-slate-600 cursor-not-allowed' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
            >
              JSON
            </button>
          </div>
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


      {/* Input Area */}
      <form onSubmit={handleConsultSubmit} className="flex gap-2 p-4 bg-slate-900 border-t border-slate-800">
        <input
          type="text"
          value={promptInput}
          onChange={(e) => setPromptInput(e.target.value)}
          placeholder="Consult Strategy AI..."
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
          disabled={isConsulting}
        />
        <button
          type="submit"
          disabled={isConsulting || !promptInput.trim()}
          className="px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-sm font-medium hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isConsulting ? 'Consulting...' : 'Submit'}
        </button>
      </form>

      {/* Glow effect */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>
    </div>
  );
}