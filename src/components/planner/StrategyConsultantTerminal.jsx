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
  const [modelPreference, setModelPreference] = useState('llama-3.1'); // Default model

  const [connectionStatus, setConnectionStatus] = useState('CONNECTING');
  const [isJsonValid, setIsJsonValid] = useState(false);
  const [parsedStrategyData, setParsedStrategyData] = useState(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [exportFormat, setExportFormat] = useState(() => localStorage.getItem('terminal_export_format') || 'Markdown');
  const [promptInput, setPromptInput] = useState(() => sessionStorage.getItem('strategy_prompt_cache') || '');

  useEffect(() => {
    sessionStorage.setItem('strategy_prompt_cache', promptInput);
  }, [promptInput]);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [isConsulting, setIsConsulting] = useState(false);
  const [showFallbackBanner, setShowFallbackBanner] = useState(false);
  const [consultError, setConsultError] = useState(null);
  const [networkStatus, setNetworkStatus] = useState(navigator.onLine ? 'Connected' : 'Offline');
  const terminalRef = useRef(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTo({
        top: terminalRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [displayText, isTyping]);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const handleOnline = () => setNetworkStatus('Connected');
    const handleOffline = () => setNetworkStatus('Offline');

    // Listen for custom reconnecting events if needed, but online/offline is good
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
    setAutoScroll(isAtBottom);
  };

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [displayText, autoScroll]);



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
              setSessionId(crypto.randomUUID());
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
    setShowFallbackBanner(false);
    setConsultError(null);

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
          session_id: sessionId,
          model_preference: modelPreference
        })
      });

      const data = await response.json();

      if (data.success && data.data) {
        setIsJsonValid(true);
        setParsedStrategyData(data.data);
        const payload = JSON.stringify(data.data, null, 2);
        setStrategy(payload);
        setStrategyHistory(prev => [...prev, payload].slice(-3));

        if (data.ai_model) {
           window.localStorage.setItem("ai_model", data.ai_model);
           setProvider(data.ai_model === "llama-3.1" ? "EDGE-LLAMA-3.1-8B" : "EDGE-MISTRAL-7B");
           // Trigger a storage event manually if we want the diagnostics panel to update without a refresh (or we can just let it be on re-render)
           window.dispatchEvent(new Event("storage"));
        } else {
           setProvider('EDGE-LLAMA-3.1-8B');
        }
        setPromptInput('');
      } else {
        throw new Error(data.error || "Unknown error during AI consultation.");
      }
    } catch (err) {
      setIsTyping(false);
      setConsultError(err.message || "Unknown error during AI consultation.");
      setShowFallbackBanner(true);
    } finally {
      setIsConsulting(false);
    }
  };


  // Handles copying the recommendation strategy to the clipboard
  // Supports switching between Markdown and JSON formats with defensive fallbacks

  const handleDownloadTranscript = () => {
    let transcriptText = "";
    if (parsedStrategyData) {
        const riskLevel = parsedStrategyData?.riskLevel || 'UNKNOWN';
        const analysis = parsedStrategyData?.analysis || 'No analysis available.';
        const actionItems = parsedStrategyData?.actionItems || [];

        transcriptText = `====================================================\n`;
        transcriptText += `AXiM Green Machine Strategy Evaluation Transcript\n`;
        transcriptText += `Date: ${new Date().toLocaleString()}\n`;
        transcriptText += `Risk Level: ${riskLevel}\n`;
        transcriptText += `====================================================\n\n`;
        transcriptText += `ANALYSIS:\n${analysis}\n\n`;
        transcriptText += `ACTION ITEMS:\n`;
        actionItems.forEach(item => transcriptText += `- ${item}\n`);
    } else {
        transcriptText = "No active strategy generated.";
    }

    const blob = new Blob([transcriptText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `strategy-consult-transcript-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSpeak = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    if (!strategy) return;

    // Attempt to use parsed strategy data analysis for speech, fallback to raw text if not JSON
    const textToSpeak = parsedStrategyData?.analysis || strategy;

    if (textToSpeak) {
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
      setIsSpeaking(true);
    }
  };

    const [isMarkdownCopied, setIsMarkdownCopied] = useState(false);
  const handleCopyMarkdown = async () => {
    if (!parsedStrategyData) return;
    try {
      const markdown = `### AXiM Green Machine Strategy Recommendation
**Risk Level:** ${parsedStrategyData.riskLevel || 'N/A'}

#### Analysis
${parsedStrategyData.analysis || 'N/A'}

#### Action Items
${(parsedStrategyData.actionItems || []).map(item => `- ${item}`).join('\n')}`;
      await navigator.clipboard.writeText(markdown);
      setIsMarkdownCopied(true);
      setTimeout(() => setIsMarkdownCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy markdown', err);
    }
  };

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
    <div className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/50 rounded-xl flex flex-col h-full shadow-2xl overflow-hidden relative">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          {parsedStrategyData && parsedStrategyData.ai_inference_ms !== undefined && (
            <span className="text-[10px] font-mono px-2 py-1 bg-slate-800/50 rounded text-slate-400 border border-slate-700">
              Inference: {parsedStrategyData.ai_inference_ms}ms
            </span>
          )}
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
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" title="Edge AI Pipeline Ready"></div>
          {/* Model Preference Toggle */}
          <div className="flex items-center bg-slate-800/80 rounded border border-slate-700/50 p-0.5 mr-2">
            <button
              type="button"
              onClick={() => setModelPreference('llama-3.1')}
              className={`px-2 py-1 text-xs font-mono rounded transition-colors ${modelPreference === 'llama-3.1' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-300'}`}
            >
              Llama 3.1 Primary
            </button>
            <button
              type="button"
              onClick={() => setModelPreference('mistral-7b')}
              className={`px-2 py-1 text-xs font-mono rounded transition-colors ${modelPreference === 'mistral-7b' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-300'}`}
            >
              Mistral 7B Secondary
            </button>
          </div>
          <button
            onClick={() => {
              setDisplayText('');
              setStrategyHistory([]);
              setStrategy('');
              setPromptInput('');
              setParsedStrategyData(null);
              setIsJsonValid(false);
              if (typingIntervalRef.current) {
                clearInterval(typingIntervalRef.current);
              }
              typedLengthRef.current = 0;
              setIsTyping(false);
              setSessionId(crypto.randomUUID());
            }}
            className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 bg-slate-800 text-blue-400 border border-slate-700 hover:bg-slate-700 rounded transition-colors"
          >
            <SafeIcon name="RefreshCw" className="w-3 h-3" />
            New Session
          </button>

          <button
            className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded border ${strategy ? (isSpeaking ? 'bg-indigo-900/50 text-indigo-400 border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 cursor-pointer') : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'}`}
            disabled={!strategy}
            onClick={handleSpeak}
            title={isSpeaking ? "Stop Synthesis" : "Listen to Strategy"}
          >
            <SafeIcon name={isSpeaking ? "VolumeX" : "Volume2"} className={`w-3 h-3 ${isSpeaking ? 'animate-pulse' : ''}`} />
            {isSpeaking ? 'Speaking...' : 'Listen'}
          </button>

                    <button
            className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded border ${!parsedStrategyData ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed' : 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-700 cursor-pointer'}`}
            disabled={!parsedStrategyData}
            onClick={handleCopyMarkdown}
          >
            <SafeIcon name={isMarkdownCopied ? "CheckCircle" : "Copy"} className="w-3 h-3" />
            {isMarkdownCopied ? "Copied!" : "Copy Markdown"}
          </button>

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
          {parsedStrategyData && parsedStrategyData.ai_inference_ms && (
            <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 bg-slate-800 text-slate-300 rounded border border-slate-700 font-mono">
              {parsedStrategyData.ai_inference_ms}ms • {parsedStrategyData.ai_model || 'Llama 3.1'}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">
            <SafeIcon name="Shield" className="w-3 h-3" />
            {provider !== '{provider}' ? provider : 'DeepSeek-V3'}
          </span>
          <button
            onClick={handleDownloadTranscript}
            title="Download Transcript (.txt)"
            className="p-1.5 rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors flex items-center border border-slate-700 ml-2"
          >
            <SafeIcon name="Download" className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={terminalRef}
        onScroll={handleScroll}
        className="p-6 flex-1 overflow-y-auto font-mono text-sm leading-relaxed relative custom-scrollbar"
      >
        <div className="text-emerald-500/50 mb-4 select-none">
          {'>'} Initializing weekly financial audit cron...<br/>
          {'>'} Connecting to public.blockchain_transactions... OK<br/>
          {'>'} Fetching MARKET_CACHE from Edge... OK<br/>
          {'>'} Routing context to DeepSeek proxy... <span className="text-emerald-400 animate-pulse">AWAITING RESPONSE</span>
        </div>
        
        {parsedStrategyData && parsedStrategyData._node_health_index !== undefined && (
           <div className="absolute top-6 right-6 flex flex-col gap-2 items-end">
              <div className="bg-slate-900/80 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)] rounded-lg p-3 flex flex-col items-end backdrop-blur-sm">
                 <span className="text-[10px] uppercase text-emerald-500/80 tracking-wider font-bold mb-1">Node Health Index</span>
                 <span className="text-2xl font-bold text-emerald-400">{Number(parsedStrategyData._node_health_index).toFixed(2)}</span>
              </div>
           </div>
        )}
        {parsedStrategyData && parsedStrategyData.riskLevel && (
           <div className="absolute top-6 right-6 mt-20 flex flex-col gap-2 items-end">
              <div className={`bg-slate-900/80 border rounded-lg p-3 flex flex-col items-end backdrop-blur-sm ${
                parsedStrategyData.riskLevel === 'Low' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                parsedStrategyData.riskLevel === 'Medium' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}>
                 <span className="text-[10px] uppercase tracking-wider font-bold mb-1 opacity-80">Risk Level</span>
                 <span className="text-xl font-bold">{parsedStrategyData.riskLevel}</span>
              </div>
           </div>
        )}


        {showFallbackBanner && (
           <div className="mb-4 bg-amber-900/40 border border-amber-500/50 p-4 rounded-lg flex items-center gap-3 shadow-[0_0_15px_rgba(245,158,11,0.2)] backdrop-blur-md relative overflow-hidden">
             <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/10 to-transparent animate-[shimmer_2s_infinite]"></div>
             <SafeIcon name="AlertCircle" className="w-5 h-5 text-amber-400 z-10" />
             <span className="text-amber-200 text-sm font-medium z-10">
               Notice: Live risk evaluation operating in fallback mode. Standard strategy recommendations active.
             </span>
           </div>
        )}

        {/* Investing Brain Decision Card */}
        {!isTyping && parsedStrategyData && (parsedStrategyData.riskViolation !== undefined || parsedStrategyData.actionItems) && (
           <div className="mb-6 mt-4 p-4 rounded-lg bg-slate-900/60 border border-slate-700/50 shadow-lg backdrop-blur-md relative overflow-hidden flex flex-col gap-3">
             <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none"></div>

             <div className="flex items-center justify-between z-10 border-b border-slate-700/50 pb-2 mb-1">
                <h3 className="text-sm font-bold text-slate-200 tracking-wide flex items-center gap-2">
                  <SafeIcon name="Brain" className="w-4 h-4 text-emerald-400" />
                  Green Machine Risk Evaluation
                </h3>
                {parsedStrategyData.riskViolation ? (
                  <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded flex items-center gap-1.5 shadow-[0_0_10px_rgba(225,29,72,0.3)]">
                    <SafeIcon name="AlertTriangle" className="w-3 h-3" />
                    Risk Gate: WARNING
                  </span>
                ) : (
                  <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    <SafeIcon name="CheckCircle" className="w-3 h-3" />
                    Risk Gate: PASSED
                  </span>
                )}
             </div>

             {parsedStrategyData.riskWarning && (
                <div className="z-10 bg-rose-500/10 border-l-2 border-rose-500 p-2 text-xs text-rose-300">
                  {parsedStrategyData.riskWarning}
                </div>
             )}

             <div className="z-10 flex flex-col gap-2">
                {parsedStrategyData.riskLevel && (
                  <div className="flex flex-col gap-1.5 w-full">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400 uppercase tracking-wide font-medium">Assessed Risk:</span>
                      <span className={`px-2 py-0.5 rounded font-bold ${
                          parsedStrategyData.riskLevel === 'Low' ? 'bg-emerald-500/20 text-emerald-300' :
                          parsedStrategyData.riskLevel === 'Medium' ? 'bg-amber-500/20 text-amber-300' :
                          'bg-rose-500/20 text-rose-300'
                      }`}>
                        {parsedStrategyData.riskLevel}
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden border border-slate-700/50 mt-1">
                      <div className={`h-full rounded-full transition-all duration-1000 ${
                          parsedStrategyData.riskLevel === 'Low' ? 'w-1/4 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' :
                          parsedStrategyData.riskLevel === 'Medium' ? 'w-2/4 bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' :
                          'w-full bg-rose-500 shadow-[0_0_10px_rgba(225,29,72,0.8)]'
                      }`}></div>
                    </div>
                  </div>
                )}

                {parsedStrategyData.actionItems && Array.isArray(parsedStrategyData.actionItems) && (
                  <div className="mt-2 text-sm">
                    <span className="text-slate-400 uppercase text-[10px] tracking-wide font-medium block mb-1">Strategic Directives</span>
                    <ul className="list-none space-y-1">
                      {parsedStrategyData.actionItems.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-300">
                          <span className="text-emerald-500/70 mt-0.5">▹</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
             </div>
           </div>
        )}

        <div className="text-slate-300 whitespace-pre-wrap relative">
          {consultError && (
            <div className="mb-4 bg-rose-500/10 border border-rose-500/50 p-4 rounded-lg flex flex-col items-start gap-3 shadow-[0_0_15px_rgba(225,29,72,0.2)]">
              <span className="text-rose-400 font-bold flex items-center gap-2">
                <SafeIcon name="AlertTriangle" className="w-4 h-4" />
                AI Strategic Evaluation Unavailable: {consultError}
              </span>
              <button
                onClick={(e) => {
                   e.preventDefault();
                   handleConsultSubmit();
                }}
                className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 rounded shadow-[0_0_10px_rgba(225,29,72,0.4)] text-xs font-bold transition-all hover:shadow-[0_0_15px_rgba(225,29,72,0.6)] flex items-center gap-2"
              >
                <SafeIcon name="RefreshCw" className="w-3 h-3" />
                Retry Prompt
              </button>
            </div>
          )}
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