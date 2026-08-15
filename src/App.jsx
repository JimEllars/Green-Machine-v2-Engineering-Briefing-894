import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import StrategyConsultantTerminal from './components/planner/StrategyConsultantTerminal.jsx';
import MarketFeedMatrix from './components/planner/MarketFeedMatrix';
import AffiliatePayoutGrid from './components/planner/AffiliatePayoutGrid';


import ComponentErrorBoundary from './common/ComponentErrorBoundary';
import SafeIcon from './common/SafeIcon';
import SystemDiagnosticsPanel from './components/planner/SystemDiagnosticsPanel';
import { getWorkerUrl } from './utils/workerUrl';


function App() {
  const [selectedTx, setSelectedTx] = useState(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [dlqStatus, setDlqStatus] = useState({ active: false, count: 0, quarantine_count: 0 });
  const [isFlushing, setIsFlushing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [isPurgingQuarantine, setIsPurgingQuarantine] = useState(false);
  const [isForcingOraclePing, setIsForcingOraclePing] = useState(false);
  const [forceOraclePingSuccess, setForceOraclePingSuccess] = useState(false);
  const [purgeSuccess, setPurgeSuccess] = useState(false);
  const [isSendingBriefing, setIsSendingBriefing] = useState(false);
  const [briefingSuccess, setBriefingSuccess] = useState(false);
  const [showBriefingPreview, setShowBriefingPreview] = useState(false);
  const [isBriefingConfirmModalOpen, setIsBriefingConfirmModalOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [archiveItems, setArchiveItems] = useState([]);
  const [selectedArchiveItem, setSelectedArchiveItem] = useState(null);
  const [isLoadingArchive, setIsLoadingArchive] = useState(false);
  const [toastError, setToastError] = useState(null);
  const [toastSuccess, setToastSuccess] = useState(null);
  const [readinessStatus, setReadinessStatus] = useState(null);
  const [edgeVersion, setEdgeVersion] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const [showDeptSummaryModal, setShowDeptSummaryModal] = useState(false);
  const [isTestingSignal, setIsTestingSignal] = useState(false);
  const [testSymbol, setTestSymbol] = useState('BTC');
  const [testAmountUsdt, setTestAmountUsdt] = useState(500);
  const [signalTestResult, setSignalTestResult] = useState(null);
  const [deptSummaryForm, setDeptSummaryForm] = useState({ department: 'Financial Operations', updatesCompleted: '', activeWork: '', questions: '' });
  const [isSubmittingDept, setIsSubmittingDept] = useState(false);
  const [deptSuccessMsg, setDeptSuccessMsg] = useState('');
  const [activeSummaries, setActiveSummaries] = useState([]);
  const [isLoadingSummaries, setIsLoadingSummaries] = useState(false);

  const [isPurgingDept, setIsPurgingDept] = useState(null);

  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isQuarantineModalOpen, setIsQuarantineModalOpen] = useState(false);
  const [quarantineItems, setQuarantineItems] = useState([]);
  const [isLoadingQuarantine, setIsLoadingQuarantine] = useState(false);
  const [deletingQuarantineItem, setDeletingQuarantineItem] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);
  const [actionTypeFilter, setActionTypeFilter] = useState('All Actions');


  const [isNukingQuarantine, setIsNukingQuarantine] = useState(false);
  const handleNukeQuarantine = async () => {
    const confirmation = prompt("WARNING: This will permanently delete all quarantined payloads. Type 'NUKE' to confirm.");
    if (confirmation !== 'NUKE') {
      return;
    }

    setIsNukingQuarantine(true);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/quarantine/all`, {
        method: 'DELETE',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setQuarantineItems([]);
        setToastError('GLOBAL QUARANTINE PURGE COMPLETE');
        setTimeout(() => setToastError(''), 3000);
      } else {
        setToastError('Failed to nuke quarantine');
        setTimeout(() => setToastError(''), 3000);
      }
    } catch (e) {
      setToastError('Failed to nuke quarantine');
      setTimeout(() => setToastError(''), 3000);
    } finally {
      setIsNukingQuarantine(false);
    }
  };

  const [isClearingAudit, setIsClearingAudit] = useState(false);
  const handleClearAuditLogs = async () => {
    setIsClearingAudit(true);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/audit-logs`, {
        method: 'DELETE',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setAuditLogs([]);
        setToastError('Logs Purged');
        setTimeout(() => setToastError(''), 3000);
      } else {
        setToastError('Failed to clear audit logs');
        setTimeout(() => setToastError(''), 3000);
      }
    } catch (e) {
      setToastError('Failed to clear audit logs');
      setTimeout(() => setToastError(''), 3000);
    } finally {
      setIsClearingAudit(false);
    }
  };

  const fetchAuditLogs = async (filter = 'All Actions') => {
    setIsLoadingAuditLogs(true);
    try {
      const workerUrl = getWorkerUrl();
      const query = filter !== 'All Actions' ? `?action_type=${encodeURIComponent(filter)}` : '';
      const res = await fetch(`${workerUrl}/api/admin/audit-logs${query}`, {
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      } else {
        setToastError('Failed to fetch audit logs');
        setTimeout(() => setToastError(null), 3000);
      }
    } catch(e) {
      console.error('Failed to fetch audit logs:', e);
      setToastError('Network error fetching audit logs');
      setTimeout(() => setToastError(null), 3000);
    } finally {
      setIsLoadingAuditLogs(false);
    }
  };

  useEffect(() => {
    if (isAuditModalOpen) {
      fetchAuditLogs(actionTypeFilter);
    }
  }, [actionTypeFilter, isAuditModalOpen]);


  const handleVerifyReadiness = async () => {
    setIsVerifying(true);
    setReadinessStatus(null);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/verify-deployment`, {
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ""
        }
      });

      if (res.ok) {
        const data = await res.json();
        setReadinessStatus({
          isOperational: data.deployment_status === 'OPERATIONAL'
        });

        // Hide toast after 5s
        setTimeout(() => setReadinessStatus(null), 5000);
      } else {
        setReadinessStatus({ isOperational: false });
        setTimeout(() => setReadinessStatus(null), 5000);
      }
    } catch (e) {
      console.error('Verify deployment error', e);
      setReadinessStatus({ isOperational: false });
      setTimeout(() => setReadinessStatus(null), 5000);
    } finally {
      setIsVerifying(false);
    }
  };



  const fetchBriefingArchive = async () => {
    setIsLoadingArchive(true);
    setArchiveItems([]);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/briefing-archive`, {
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.archives) {
          setArchiveItems(data.archives);
        }
      } else {
        setToastError('Failed to fetch archive');
        setTimeout(() => setToastError(''), 3000);
      }
    } catch (e) {
      setToastError('Failed to fetch archive');
      setTimeout(() => setToastError(''), 3000);
    } finally {
      setIsLoadingArchive(false);
    }
  };


  const fetchQuarantineItems = async () => {
    setIsLoadingQuarantine(true);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/quarantine`, {
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        setQuarantineItems(data.items || []);
      } else {
        setToastError('Failed to fetch quarantine items');
        setTimeout(() => setToastError(null), 3000);
      }
    } catch(e) {
      console.error('Failed to fetch quarantine items:', e);
      setToastError('Network error fetching quarantine items');
      setTimeout(() => setToastError(null), 3000);
    } finally {
      setIsLoadingQuarantine(false);
    }
  };

  const deleteQuarantineItem = async (keyName) => {
    setDeletingQuarantineItem(keyName);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/quarantine`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        },
        body: JSON.stringify({ key_name: keyName })
      });
      if (res.ok) {
        setQuarantineItems(prev => prev.filter(item => item.key_name !== keyName));
      } else {
        setToastError('Failed to delete quarantine item');
        setTimeout(() => setToastError(null), 3000);
      }
    } catch(e) {
      console.error('Failed to delete quarantine item:', e);
      setToastError('Network error deleting quarantine item');
      setTimeout(() => setToastError(null), 3000);
    } finally {
      setDeletingQuarantineItem(null);
    }
  };

  useEffect(() => {
    if (isQuarantineModalOpen) {
      fetchQuarantineItems();
    }
  }, [isQuarantineModalOpen]);


  const handleClearDept = async (department) => {
    setIsPurgingDept(department);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/dept-summary?department=${encodeURIComponent(department)}`, {
        method: "DELETE",
        headers: {
          "X-Axim-Signature": import.meta.env.VITE_AXIM_INTERNAL_KEY || ""
        }
      });
      if (res.ok) {
        setActiveSummaries(prev => prev.filter(s => s.department !== department));
      } else {
        const err = await res.json();
        setToastError(err.error || "Failed to purge department");
        setTimeout(() => setToastError(null), 5000);
      }
    } catch (e) {
      console.error("Purge error", e);
      setToastError("Network error while purging department");
      setTimeout(() => setToastError(null), 5000);
    } finally {
      setIsPurgingDept(null);
    }
  };

  const submitDeptSummary = async () => {
      setIsSubmittingDept(true);
      setDeptSuccessMsg('');
      try {
          const workerUrl = getWorkerUrl();
          const payload = {
              department: deptSummaryForm.department,
              updatesCompleted: deptSummaryForm.updatesCompleted.split('\n').filter(s => s.trim()),
              activeWork: deptSummaryForm.activeWork.split('\n').filter(s => s.trim()),
              questions: deptSummaryForm.questions.split('\n').filter(s => s.trim()),
          };

          const res = await fetch(`${workerUrl}/api/admin/dept-summary`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
              },
              body: JSON.stringify(payload)
          });

          if (res.ok) {
              setDeptSuccessMsg('Department Summary Logged for Morning Briefing!');
              setTimeout(() => { setShowDeptSummaryModal(false); setDeptSuccessMsg(''); }, 2000);
          } else {
              setToastError('Failed to log department summary');
              setTimeout(() => setToastError(null), 3000);
          }
      } catch (e) {
          setToastError('Network error logging summary');
          setTimeout(() => setToastError(null), 3000);
      } finally {
          setIsSubmittingDept(false);
      }
  };


  const [consecutiveFailures, setConsecutiveFailures] = useState(0);

  const [showCriticalAlert, setShowCriticalAlert] = useState(false);

  const handleDiagnosticsUpdate = (status) => {
    setConsecutiveFailures(prev => {
      let isFailure = false;
      if (status.dbConnected === false || status.edgeCacheAvailable === false) {
        isFailure = true;
      }

      const newCount = isFailure ? prev + 1 : 0;
      if (newCount >= 3) {
        setShowCriticalAlert(true);
      } else if (newCount === 0) {
        setShowCriticalAlert(false);
      }
      return newCount;
    });
  };


  const [isForceDispatching, setIsForceDispatching] = useState(false);
  const handleForceDispatch = async () => {
    setIsForceDispatching(true);
    try {
      const workerUrl = getWorkerUrl();
      await fetch(`${workerUrl}/api/admin/force-briefing-dispatch`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
    } catch(e) { console.error("Force dispatch failed:", e); }
    setIsForceDispatching(false);
  };

  const [isRenewingSession, setIsRenewingSession] = useState(false);
  const [renewSessionSuccess, setRenewSessionSuccess] = useState(false);
  const [isResettingCircuit, setIsResettingCircuit] = useState(false);
  const [resetCircuitSuccess, setResetCircuitSuccess] = useState(false);

  const handleRenewAnnySession = async () => {
    setIsRenewingSession(true);
    setRenewSessionSuccess(false);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/renew-anny-session`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setRenewSessionSuccess(true);
        setTimeout(() => setRenewSessionSuccess(false), 3000);
        await checkDlq(); // Updates system diagnostics in background
      }
    } catch(e) {
      console.error('Failed to renew session:', e);
    } finally {
      setIsRenewingSession(false);
    }
  };

  const handleResetCircuit = async () => {
    setIsResettingCircuit(true);
    setResetCircuitSuccess(false);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/circuit-breaker-reset`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setResetCircuitSuccess(true);
        setTimeout(() => setResetCircuitSuccess(false), 3000);
      } else {
        throw new Error('Failed to reset circuit');
      }
    } catch (e) {
      setToastError('Oracle Circuit Reset Failed');
      setTimeout(() => setToastError(''), 5000);
    } finally {
      setIsResettingCircuit(false);
    }
  };


  const checkDlq = async () => {
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/dlq-status`, {
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
         const data = await res.json();
         setDlqStatus({ active: data.active || data.buffered_count > 0, count: data.count || data.buffered_count || 0, quarantine_count: data.quarantine_count || data.quarantined_count || 0, emailit_telemetry: data.emailit_telemetry, exec_governance: data.exec_governance, emailit_configured: data.emailit_configured, autoheal_telemetry: data.autoheal_telemetry, investing_brain_telemetry: data.investing_brain_telemetry, anny_oracle: data.anny_oracle, webhook_ingress_telemetry: data.webhook_ingress_telemetry, dlq_autoheal_telemetry: data.dlq_autoheal_telemetry });
      }
    } catch (e) {
      console.error("Failed to fetch DLQ status", e);
    }
  };


  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const workerUrl = getWorkerUrl();
        const res = await fetch(`${workerUrl}/api/health`);
        if (res.ok) {
          const data = await res.json();
          if (data.edge_version) setEdgeVersion(data.edge_version);
        }
      } catch (e) {
        console.error("Failed to fetch health for version", e);
      }
    };
    fetchHealth();
    checkDlq();
    const interval = setInterval(checkDlq, 15000); // Check every 15s
    return () => clearInterval(interval);
  }, []);



  const [fullSignalResult, setFullSignalResult] = useState(null);

  const handleTestSignal = async () => {
    setIsTestingSignal(true);
    setSignalTestResult(null);
    setFullSignalResult(null);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/validate-signal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        },
        body: JSON.stringify({ symbol: testSymbol, action: 'buy', amount_usdt: Number(testAmountUsdt) })
      });
      const data = await res.json();
      if (res.ok) {
        setFullSignalResult(data);
        setSignalTestResult(data.approved ? `Signal Test: APPROVED (CFO: ${data.cfo_state})` : `Signal Test: REJECTED (${data.reason})`);
        setTimeout(() => setSignalTestResult(null), 5000);
      } else {
        setToastError('Failed to test signal');
        setTimeout(() => setToastError(null), 3000);
      }
    } catch(e) {
      console.error('Failed to test signal:', e);
      setToastError('Network error testing signal');
      setTimeout(() => setToastError(null), 3000);
    } finally {
      setIsTestingSignal(false);
    }
  };
  const handleFlushDLQ = async () => {
    setIsFlushing(true);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/dlq-flush`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.remaining) {
          setTimeout(handleFlushDLQ, 2000);
        } else {
          setIsFlushing(false);
        }
        await checkDlq();
      } else {
        setIsFlushing(false);
      }
    } catch(e) {
      console.error('Failed to flush DLQ:', e);
      setIsFlushing(false);
    }
  };



  const handleForceOraclePing = async () => {
    setIsForcingOraclePing(true);
    setForceOraclePingSuccess(false);
    try {
      const res = await fetch(`${getWorkerUrl()}/api/admin/force-oracle-ping`, {
        method: 'POST',
        headers: { 'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY }
      });
      if (res.ok) {
        setForceOraclePingSuccess(true);
        setTimeout(() => setForceOraclePingSuccess(false), 3000);
        checkDlq();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsForcingOraclePing(false);
    }
  };

  const handleRefreshTelemetry = async () => {
    checkDlq();
    setToastSuccess('Telemetry Refreshed!');
    setTimeout(() => setToastSuccess(null), 3000);
  };
const handleSyncKV = async () => {
    setIsSyncing(true);
    setSyncSuccess(false);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/cache-sync`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 2000);
      }
    } catch(e) {
      console.error('Failed to sync KV:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  const [sweepSuccess, setSweepSuccess] = useState(false);

  const handlePurgeQuarantine = async () => {
    setIsPurgingQuarantine(true);
    setPurgeSuccess(false);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/quarantine-purge`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setPurgeSuccess(true);
        setTimeout(() => setPurgeSuccess(false), 2000);
        await checkDlq();
      }
    } catch(e) {
      console.error('Failed to purge quarantine:', e);
    } finally {
      setIsPurgingQuarantine(false);
    }
  };

  const [isPurgingRetries, setIsPurgingRetries] = useState(false);
  const [purgeRetriesSuccess, setPurgeRetriesSuccess] = useState(false);
  const [purgeRetriesCount, setPurgeRetriesCount] = useState(0);

  const handlePurgeRetries = async () => {
    setIsPurgingRetries(true);
    setPurgeRetriesSuccess(false);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/quarantine-retry-purge`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        setPurgeRetriesCount(data.purged_count);
        setPurgeRetriesSuccess(true);
        setTimeout(() => setPurgeRetriesSuccess(false), 2000);
      } else {
        setToastError('Failed to purge retries');
        setTimeout(() => setToastError(null), 3000);
      }
    } catch(e) {
      console.error('Failed to purge retries:', e);
      setToastError('Network error purging retries');
      setTimeout(() => setToastError(null), 3000);
    } finally {
      setIsPurgingRetries(false);
    }
  };

  const handleSendExecBriefing = async () => {
    setIsSendingBriefing(true);
    setBriefingSuccess(false);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(`${workerUrl}/api/admin/send-exec-briefing`, {
        method: 'POST',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success !== false) {
        setBriefingSuccess(true);
        setTimeout(() => setBriefingSuccess(false), 2000);
      } else {
        const errorMsg = data?.error || res.statusText || 'Unknown Error';
        const errorCode = data?.code || res.status || 'ERR';
        setToastError(`Briefing Error [${errorCode}]: ${errorMsg}`);
        setTimeout(() => setToastError(null), 4000);
      }
    } catch(e) {
      console.error('Failed to send exec briefing:', e);
      setToastError(`Briefing Error [NET_ERR]: ${e.message || 'Network failure'}`);
      setTimeout(() => setToastError(null), 4000);
    } finally {
      setIsSendingBriefing(false);
    }
  };

  const handleManualSweep = async () => {
    setIsSweeping(true);

    try {
      // In a real environment, you'd use a service role key for this sensitive operation if the Edge Function requires it,
      // but for this prototype, we'll use the anon key if that's what's available, or a specific env var.
      const workerUrl = getWorkerUrl();
      const response = await fetch(`${workerUrl}/api/admin/trigger-financial-audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        },
        body: JSON.stringify({
          trigger_source: 'manual_sweep_dashboard',
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        console.error('Sweep failed:', response.statusText);
      } else {
        setSweepSuccess(true);
        setTimeout(() => setSweepSuccess(false), 1500);
      }
    } catch (error) {
       console.error('Sweep error:', error);
    } finally {
      setIsSweeping(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      
      {/* Overlays */}
      {showBriefingPreview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-zinc-800 bg-zinc-950">
              <h2 className="text-white font-bold flex items-center gap-2">
                <SafeIcon name="Mail" className="w-4 h-4 text-emerald-500" />
                Executive Briefing Preview
              </h2>
              <button onClick={() => setShowBriefingPreview(false)} className="text-slate-400 hover:text-white transition-colors">
                <SafeIcon name="X" className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 bg-slate-100 flex-grow overflow-y-auto">
              <iframe
                title="Briefing Preview"
                srcDoc={`
                  <html>
                    <head><style>body { font-family: sans-serif; color: #333; margin: 0; padding: 0; }</style></head>
                    <body>
                      <h2>Executive Daily Briefing</h2>
                      <h3>App Development Progress Summary</h3>
                      <p>Sprint 1.3: Telemetry Integration & Polish is active.</p>
                      <h3>System Work & Operations Summary</h3>
                      <ul>
                        <li>DLQ Buffered Count: ${dlqStatus.count}</li>
                        <li>Quarantined Count: ${dlqStatus.quarantine_count}</li>
                        <li>Market Cache - BTC: Live, ETH: Live, SOL: Live (Resolved via Edge)</li>
                      </ul>
                      <h3>Executive Inquiry Block</h3>
                      <p>Please reply directly to this email to provide feedback or inquiries.</p>
                    </body>
                  </html>
                `}
                className="w-full h-64 border-0 rounded"
                sandbox=""
              />
            </div>
            {!dlqStatus.emailit_configured && (
              <div className="bg-amber-500/20 border-b border-amber-500/50 p-2 text-center text-amber-400 text-xs font-bold flex justify-center items-center gap-2">
                <SafeIcon name="AlertTriangle" className="w-4 h-4" />
                ⚠️ EMAILIT_API_KEY secret is not set in Cloudflare Worker. Emails cannot be dispatched until configured.
              </div>
            )}
            <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex justify-end gap-3">
              <button
                onClick={() => setShowBriefingPreview(false)}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm transition-colors border border-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowBriefingPreview(false);
                  handleSendExecBriefing();
                }}
                disabled={isSendingBriefing || !dlqStatus.emailit_configured}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-colors shadow-[0_0_15px_rgba(99,102,241,0.5)] flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSendingBriefing ? <SafeIcon name="Loader" className="w-4 h-4 animate-spin" /> : <SafeIcon name="Send" className="w-4 h-4" />}
                {!dlqStatus.emailit_configured ? 'Relay Unconfigured' : 'Confirm & Dispatch to Executive Team'}
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                <SafeIcon name="Hexagon" className="text-slate-900 w-5 h-5" />
              </div>
              <div>
                <h1 className="font-bold tracking-tight text-white leading-none">AXiM Core</h1>
                <span className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">The Green Machine v2</span>
              </div>
            </div>
            
            <div className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
              <a href="#" className="text-white">Dashboard</a>
              <a href="#" className="hover:text-white transition-colors">Ledger</a>
              <a href="#" className="hover:text-white transition-colors">Market Cache</a>
              <a href="#" className="hover:text-white transition-colors">AI Strategies</a>
            </div>

            <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${dlqStatus.active ? 'bg-amber-500/10 border-amber-500/50 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
              <div className={`w-2 h-2 rounded-full ${dlqStatus.active ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
              Edge Buffer Status {dlqStatus.active && `(${dlqStatus.count})`}
            </div>

            <div className="flex items-center gap-4">
               <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-md border border-slate-700 text-xs text-slate-300">
                <SafeIcon name="Lock" className="w-3.5 h-3.5 text-emerald-400" />
                axim_internal_finance
              </div>
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center cursor-pointer hover:border-emerald-500 transition-colors">
                <SafeIcon name="User" className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* System Health Snapshot Card */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-700/50 rounded-xl p-4 shadow-2xl flex flex-wrap gap-4 items-center justify-between relative">
          <button onClick={handleRefreshTelemetry} className="absolute top-4 right-4 text-slate-400 hover:text-emerald-400 transition-colors" title="Refresh Telemetry">
            <SafeIcon name="RefreshCw" className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.2)]">
              <SafeIcon name="Activity" className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">System Status</div>
              <div className="text-sm text-emerald-400 font-bold flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                100% Operational
              </div>
            </div>
          </div>
          <div className="h-10 w-px bg-zinc-800 hidden md:block"></div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Oracle Link</div>
            <div className={`text-sm font-bold ${dlqStatus?.anny_oracle?.session_valid ? 'text-emerald-400' : 'text-amber-400'}`}>
              {dlqStatus?.anny_oracle?.session_valid ? 'Active' : 'Public Guest'}
            </div>
          </div>
          <div className="h-10 w-px bg-zinc-800 hidden md:block"></div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Circuit Breaker</div>
            <div className="text-sm font-bold text-emerald-400">CLOSED</div>
          </div>
          <div className="h-10 w-px bg-zinc-800 hidden md:block"></div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">DLQ Queue</div>
            <div className={`text-sm font-bold ${dlqStatus.count > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {dlqStatus.count > 0 ? `${dlqStatus.count} Pending` : 'Clean'}
            </div>
          </div>
          <div className="h-10 w-px bg-zinc-800 hidden md:block"></div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Webhook Ingress</div>
            <div className={`text-sm font-bold ${dlqStatus?.webhook_ingress_telemetry?.status === 'OPERATIONAL' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {dlqStatus?.webhook_ingress_telemetry?.status === 'OPERATIONAL' ? 'Operational' : 'Degraded'}
            </div>
          </div>
        </div>
      </div>

      {showCriticalAlert && (
        <div className="bg-rose-900/90 border-b border-rose-500/50 text-rose-100 px-4 py-3 shadow-[0_4px_20px_rgba(225,29,72,0.3)] sticky top-16 z-40 transition-all duration-300">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <SafeIcon name="AlertTriangle" className="w-5 h-5 text-rose-400 animate-pulse" />
            <p className="text-sm font-bold tracking-wide">CRITICAL PIPELINE DISRUPTION DETECTED: Core Infrastructure Tier Degraded. Ledger Safely Buffered to Edge KV DLQ Cache Node.</p>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-white mb-2">Financial Command Cockpit</h2>
            <p className="text-slate-400 text-sm">Autonomous Ecosystem Asset Planner & Ledger Gateway</p>
          </div>
          <div className="flex gap-2">

            <button
              onClick={handleVerifyReadiness}
              disabled={isVerifying}
              className={`px-4 py-2 ${isVerifying ? 'bg-indigo-600' : 'bg-slate-700 hover:bg-slate-600'} text-white rounded-lg text-sm font-bold transition-all border border-slate-600 flex items-center gap-2`}
            >
              {isVerifying ? <SafeIcon name="Loader" className="w-4 h-4 animate-spin" /> : <SafeIcon name="CheckCircle" className="w-4 h-4" />}
              Verify Readiness
            </button>
            <button 
              onClick={handleManualSweep}
              disabled={isSweeping}
              className={`px-4 py-2 ${isSweeping ? 'bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.5)]' : sweepSuccess ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-emerald-600 hover:bg-emerald-500'} disabled:opacity-90 text-white rounded-lg text-sm font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] flex items-center gap-2`}
            >
              {isSweeping ? <SafeIcon name="Loader" className="w-4 h-4 animate-spin" /> : <SafeIcon name="Zap" className="w-4 h-4" />}
              {isSweeping ? 'Scraping Multi-App Resource Debts...' : 'Manual Sweep'}
            </button>
            <button 
              onClick={() => setIsLogsOpen(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-all border border-slate-700 flex items-center gap-2"
            >
              <SafeIcon name="Terminal" className="w-4 h-4" />
              Edge Logs
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Alerts & Stats */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <SystemDiagnosticsPanel dlqStatus={dlqStatus} onDiagnosticsUpdate={handleDiagnosticsUpdate} onOpenQuarantineManager={() => setIsQuarantineModalOpen(true)} />
          </div>

          {/* Center Column: Market & Ledger */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <ComponentErrorBoundary>
                    <MarketFeedMatrix />
                  </ComponentErrorBoundary>
            <AffiliatePayoutGrid onSelectTx={setSelectedTx} />
          </div>

          {/* Right Column: AI Strategy Terminal */}
          <div className="lg:col-span-3 flex flex-col min-h-[600px] sticky top-24">
            <StrategyConsultantTerminal />

            
            <div className="mt-6 bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/50 rounded-xl p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-white font-bold flex items-center gap-2 text-sm">
                  <SafeIcon name="Tool" className="text-emerald-500 w-4 h-4" />
                  Quick Actions
                </h3>

                <div className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-mono tracking-wide ${dlqStatus?.emailit_telemetry?.last_attempt ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${dlqStatus?.emailit_telemetry?.last_attempt ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
                  {dlqStatus?.emailit_telemetry?.last_attempt
                    ? `Last Briefing: ${new Date(dlqStatus.emailit_telemetry.last_attempt).toLocaleString()}`
                    : 'Last Briefing: Pending Schedule'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleSyncKV}
                  className={`p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider ${isSyncing ? 'bg-emerald-500/20 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)] text-emerald-400' : syncSuccess ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/50 text-slate-300'}`}
                >
                  {isSyncing ? 'Syncing...' : syncSuccess ? 'Synced!' : 'Sync KV'}
                </button>
                <button
                  onClick={handlePurgeQuarantine}
                  className={`p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider ${isPurgingQuarantine ? 'bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] text-amber-400' : purgeSuccess ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-amber-500/50 text-slate-300'}`}
                >
                  {isPurgingQuarantine ? 'Purging...' : purgeSuccess ? 'Purged!' : 'Purge Quarantined Pills'}
                </button>


                <button
                  onClick={handlePurgeRetries}
                  className={`p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider ${isPurgingRetries ? 'bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] text-amber-400' : purgeRetriesSuccess ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-amber-500/50 text-slate-300'}`}
                >
                  {isPurgingRetries ? 'Purging...' : purgeRetriesSuccess ? `${purgeRetriesCount} Quarantined Retries Purged` : 'Purge Quarantined Retries'}
                </button>

                <button
                  onClick={handleRenewAnnySession}
                  className={`p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider ${isRenewingSession ? 'bg-indigo-500/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] text-indigo-400' : renewSessionSuccess ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-indigo-500/50 text-slate-300'}`}
                >
                  {isRenewingSession ? 'Renewing...' : renewSessionSuccess ? 'Session Renewed!' : 'Renew Anny Session'}
                </button>


                <button
                  onClick={handleForceOraclePing}
                  className={`p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider ${isForcingOraclePing ? 'bg-cyan-500/20 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)] text-cyan-400' : forceOraclePingSuccess ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-cyan-500/50 text-slate-300'}`}
                >
                  {isForcingOraclePing ? 'Syncing...' : forceOraclePingSuccess ? 'Cache Synced!' : 'Force Oracle Sync'}
                </button>
<button
                  onClick={handleResetCircuit}
                  className={`p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider ${isResettingCircuit ? 'bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] text-amber-400' : resetCircuitSuccess ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-rose-500/50 text-slate-300'}`}
                >
                  {isResettingCircuit ? 'Resetting...' : resetCircuitSuccess ? 'Reset to CLOSED!' : 'Reset Oracle Circuit'}
                </button>

              </div>
              <div className="mt-4 p-4 bg-slate-800/30 border border-slate-700/50 rounded-lg flex flex-col sm:flex-row gap-4 items-end">
                  <div className="flex flex-col gap-1 w-full sm:w-auto">
                    <label className="text-[10px] font-mono text-slate-400 uppercase">Test Symbol</label>
                    <select
                      value={testSymbol}
                      onChange={(e) => setTestSymbol(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
                    >
                      <option value="BTC">BTC</option>
                      <option value="ETH">ETH</option>
                      <option value="SOL">SOL</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 w-full sm:w-auto">
                    <label className="text-[10px] font-mono text-slate-400 uppercase">Amount (USDT)</label>
                    <input
                      type="number"
                      value={testAmountUsdt}
                      onChange={(e) => setTestAmountUsdt(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>
                  <button
                    onClick={handleTestSignal}
                    className={`p-2.5 bg-slate-800/50 hover:bg-slate-800 rounded border border-slate-700/50 text-xs font-bold text-slate-300 transition-colors uppercase tracking-wider h-[38px] ${isTestingSignal ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isTestingSignal ? 'Testing...' : 'Test Pre-Flight Signal'}
                  </button>
              </div>

              {fullSignalResult && fullSignalResult.dry_run_simulation && (
                  <div className="mt-4 p-4 bg-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-xl shadow-2xl relative overflow-hidden">
                    <div className="flex items-center gap-2 mb-3">
                        <SafeIcon name="Activity" className="w-4 h-4 text-emerald-400" />
                        <h4 className="text-sm font-bold text-slate-100">Pre-Flight Dry-Run Simulation</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                            <span className="text-[10px] font-mono text-slate-400 uppercase">CFO Trend State</span>
                            <div className="text-sm font-bold text-slate-200 mt-1">{fullSignalResult.cfo_state || 'Wait'}</div>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                            <span className="text-[10px] font-mono text-slate-400 uppercase">Estimated Fill Price</span>
                            <div className="text-sm font-bold text-emerald-400 mt-1">${fullSignalResult.dry_run_simulation.estimated_fill_price || 'N/A'}</div>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                            <span className="text-[10px] font-mono text-slate-400 uppercase">Estimated Slippage</span>
                            <div className="text-sm font-bold text-slate-200 mt-1">{fullSignalResult.dry_run_simulation.estimated_slippage_pct ? `${fullSignalResult.dry_run_simulation.estimated_slippage_pct}%` : '0.10%'}</div>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                            <span className="text-[10px] font-mono text-slate-400 uppercase">Liquidity Check</span>
                            <div className={`text-sm font-bold mt-1 ${fullSignalResult.dry_run_simulation.liquidity_check === 'PASS' ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {fullSignalResult.dry_run_simulation.liquidity_check || 'PASS'}
                            </div>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 col-span-2">
                            <span className="text-[10px] font-mono text-slate-400 uppercase">Available USDT</span>
                            <div className="text-sm font-bold text-slate-200 mt-1">${fullSignalResult.available_usdt || '0.00'}</div>
                        </div>
                    </div>
                  </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                {['Audit Logs'].map((action) => (
                  <button key={action} onClick={() => { setIsAuditModalOpen(true); fetchAuditLogs(); }} className="p-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg border border-slate-700/50 text-[10px] font-bold text-slate-300 transition-colors uppercase tracking-wider">
                    {action}
                  </button>
                ))}
                <button
                  onClick={() => setShowBriefingPreview(true)}
                  className="p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider flex items-center justify-center gap-2 bg-slate-800/50 hover:bg-slate-800 border-indigo-500/50 text-indigo-300 preview-briefing-btn"
                >
                  <SafeIcon name="Eye" className="w-3 h-3" />
                  Preview Briefing
                </button>

                <button
                  onClick={() => setIsBriefingConfirmModalOpen(true)}
                  className={`p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider flex items-center justify-center gap-2 ${isSendingBriefing ? 'bg-indigo-500/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] text-indigo-400' : briefingSuccess ? 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.8)]' : 'bg-slate-800/50 hover:bg-slate-800 border-indigo-500/50 text-slate-300'}`}
                >
                  <SafeIcon name="Mail" className={`w-3 h-3 ${isSendingBriefing ? 'animate-pulse' : ''}`} />
                  {isSendingBriefing ? 'Dispatching...' : briefingSuccess ? 'Briefing Sent!' : 'Dispatch Exec Briefing'}
                </button>

                <button
                  onClick={() => {
                    setIsArchiveModalOpen(true);
                    fetchBriefingArchive();
                  }}
                  className="p-3 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-[10px] font-bold text-slate-300 transition-colors uppercase tracking-wider flex items-center justify-center gap-2"
                >
                  <SafeIcon name="Archive" className="w-3 h-3" />
                  View Briefing Archive
                </button>

                <button
                  onClick={async () => {
                    setShowDeptSummaryModal(true);
                    setIsLoadingSummaries(true);
                    try {
                        const workerUrl = getWorkerUrl();
                        const res = await fetch(`${workerUrl}/api/admin/dept-summary`, {
                            headers: {
                                'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
                            }
                        });
                        if (res.ok) {
                            const data = await res.json();
                            setActiveSummaries(data.summaries || []);
                        }
                    } catch (e) {
                        console.error('Failed to fetch active summaries', e);
                    } finally {
                        setIsLoadingSummaries(false);
                    }
                  }}
                  className="col-span-2 p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                >
                  <SafeIcon name="FileText" className="w-3 h-3" />
                  Submit Dept Summary
                </button>
                <button

                  onClick={handleFlushDLQ}
                  className={`col-span-2 p-3 rounded-lg border text-[10px] font-bold transition-colors uppercase tracking-wider flex items-center justify-center gap-2 ${isFlushing ? 'bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)] text-amber-400' : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/50 text-amber-500'}`}
                >
                  <SafeIcon name="RefreshCw" className={`w-3 h-3 ${isFlushing ? 'animate-spin' : ''}`} />
                  {isFlushing ? 'Flushing Batch...' : 'Flush DLQ Buffer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>


      {showDeptSummaryModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900/90 border border-slate-700/50 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
                <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/50">
                    <h3 className="text-white font-bold flex items-center gap-2">
                        <SafeIcon name="FileText" className="w-4 h-4 text-emerald-500" />
                        Log Department Progress
                    </h3>
                    <button onClick={() => setShowDeptSummaryModal(false)} className="text-slate-400 hover:text-white">
                        <SafeIcon name="X" className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    {deptSuccessMsg ? (
                        <div className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-lg text-center font-bold">
                            {deptSuccessMsg}
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Department</label>
                                <select
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm focus:border-emerald-500 focus:outline-none"
                                    value={deptSummaryForm.department}
                                    onChange={e => setDeptSummaryForm({...deptSummaryForm, department: e.target.value})}
                                >
                                    <option value="Financial Operations">Financial Operations</option>
                                    <option value="BizDev Intelligence">BizDev Intelligence</option>
                                    <option value="Edge Infrastructure">Edge Infrastructure</option>
                                    <option value="AI Co-Pilot">AI Co-Pilot</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Completed Updates (One per line)</label>
                                <textarea
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm focus:border-emerald-500 focus:outline-none min-h-[80px]"
                                    placeholder="• Synced edge ledger..."
                                    value={deptSummaryForm.updatesCompleted}
                                    onChange={e => setDeptSummaryForm({...deptSummaryForm, updatesCompleted: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Active Work / Blockers (One per line)</label>
                                <textarea
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm focus:border-emerald-500 focus:outline-none min-h-[80px]"
                                    placeholder="• Resolving DLQ backup..."
                                    value={deptSummaryForm.activeWork}
                                    onChange={e => setDeptSummaryForm({...deptSummaryForm, activeWork: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Questions for Executive Briefing</label>
                                <textarea
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm focus:border-emerald-500 focus:outline-none min-h-[60px]"
                                    placeholder="Optional..."
                                    value={deptSummaryForm.questions}
                                    onChange={e => setDeptSummaryForm({...deptSummaryForm, questions: e.target.value})}
                                />
                            </div>
                            <button
                                onClick={submitDeptSummary}
                                disabled={isSubmittingDept}
                                className={`w-full py-3 rounded-lg font-bold transition-all text-sm flex items-center justify-center gap-2 ${isSubmittingDept ? 'bg-emerald-600/50 text-emerald-200 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)]'}`}
                            >
                                {isSubmittingDept ? <SafeIcon name="Loader" className="w-4 h-4 animate-spin" /> : <SafeIcon name="Send" className="w-4 h-4" />}
                                {isSubmittingDept ? 'Logging...' : 'Submit Dept Summary'}
                            </button>

                            <div className="mt-6 pt-6 border-t border-slate-700/50">
                                <h4 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                                    <SafeIcon name="List" className="w-4 h-4 text-slate-400" />
                                    Recent Summaries (24h Window)
                                </h4>
                                {isLoadingSummaries ? (
                                    <div className="flex items-center justify-center p-4">
                                        <SafeIcon name="Loader" className="w-5 h-5 text-emerald-500 animate-spin" />
                                    </div>
                                ) : activeSummaries.length > 0 ? (
                                    <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                        {activeSummaries.map((summary, idx) => (
                                            <div key={idx} className="bg-slate-800/80 backdrop-blur-sm border border-slate-700/50 rounded p-3 text-xs flex justify-between items-center shadow-inner">
                                                <div className="text-slate-300">
                                                    Logged for Morning Briefing: <span className="font-bold text-white">{summary.department}</span> &mdash; {summary.updatesCompleted ? summary.updatesCompleted.length : 0} Completed Updates
                                                </div>
                                                <button
                                                  onClick={() => handleClearDept(summary.department)}
                                                  disabled={isPurgingDept === summary.department}
                                                  className={`ml-2 px-2 py-1 rounded border text-[10px] font-bold uppercase transition-colors flex items-center gap-1 ${isPurgingDept === summary.department ? 'bg-amber-500/20 text-amber-400 border-amber-500/50' : 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-500/50'}`}
                                                >
                                                  {isPurgingDept === summary.department ? <SafeIcon name="Loader" className="w-3 h-3 animate-spin" /> : <SafeIcon name="Trash2" className="w-3 h-3" />}
                                                  {isPurgingDept === summary.department ? 'Clearing...' : 'Clear Dept'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-xs text-slate-500 italic text-center p-4 bg-slate-800/30 rounded border border-slate-800">
                                        No recent summaries logged.
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
          </div>
      )}


      {isQuarantineModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900/90 border border-slate-700/50 rounded-xl shadow-2xl max-w-4xl w-full overflow-hidden flex flex-col max-h-[80vh]">
                <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/50 shrink-0">
                    <h3 className="text-white font-bold flex items-center gap-2">
                        <SafeIcon name="AlertTriangle" className="w-4 h-4 text-amber-500" />
                        Quarantine Manager
                    </h3>
                    <div className="flex items-center gap-4">
                        <button
                          onClick={handleNukeQuarantine}
                          disabled={isNukingQuarantine || quarantineItems.length === 0}
                          className="bg-red-900/80 hover:bg-red-700 text-red-200 px-3 py-1.5 rounded text-xs font-bold transition-colors disabled:opacity-50"
                        >
                          {isNukingQuarantine ? 'Nuking...' : 'NUKE ALL QUARANTINED'}
                        </button>
                        <button onClick={() => setIsQuarantineModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                            <SafeIcon name="X" className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="p-4 flex-grow overflow-y-auto custom-scrollbar">
                    {isLoadingQuarantine ? (
                        <div className="flex items-center justify-center p-8">
                            <SafeIcon name="Loader" className="w-6 h-6 text-amber-500 animate-spin" />
                        </div>
                    ) : quarantineItems.length > 0 ? (
                        <div className="space-y-3">
                            {quarantineItems.map((item, idx) => (
                                <div key={idx} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 flex justify-between items-start gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-amber-400 font-mono text-xs font-bold mb-1 truncate">
                                            {item.key_name}
                                        </div>
                                        <pre className="text-slate-300 text-[10px] font-mono whitespace-pre-wrap break-all bg-slate-900/50 p-2 rounded border border-slate-800">
                                            {item.error ? item.error : JSON.stringify(item.payload, null, 2).substring(0, 100) + (JSON.stringify(item.payload, null, 2).length > 100 ? '...' : '')}
                                        </pre>
                                    </div>
                                    <button
                                        onClick={() => deleteQuarantineItem(item.key_name)}
                                        disabled={deletingQuarantineItem === item.key_name}
                                        className="px-3 py-1 bg-rose-500/20 text-rose-400 border border-rose-500/50 hover:bg-rose-500/40 rounded text-xs font-bold transition-colors shrink-0 disabled:opacity-50"
                                    >
                                        {deletingQuarantineItem === item.key_name ? 'Deleting...' : 'Delete Item'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-slate-500 text-sm text-center italic p-8 bg-slate-800/30 rounded-lg border border-slate-800">
                            No quarantined items found.
                        </div>
                    )}
                </div>
                <div className="p-4 border-t border-slate-700/50 bg-slate-800/50 flex justify-end shrink-0">
                    <button
                        onClick={() => fetchQuarantineItems()}
                        disabled={isLoadingQuarantine}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
                    >
                        <SafeIcon name="RefreshCw" className={`w-3 h-3 ${isLoadingQuarantine ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>
          </div>
      )}


      {isBriefingConfirmModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700/50 rounded-xl shadow-2xl max-w-md w-full p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center mx-auto mb-4">
              <SafeIcon name="AlertTriangle" className="w-6 h-6 text-amber-500" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Manual Briefing Dispatch</h3>
            <p className="text-slate-300 text-sm mb-6">Warning: You are about to dispatch an executive briefing out of the standard CRON schedule. Do you wish to proceed?</p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => setIsBriefingConfirmModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setIsBriefingConfirmModalOpen(false);
                  handleSendExecBriefing();
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold transition-colors shadow-[0_0_15px_rgba(99,102,241,0.5)] flex items-center gap-2"
              >
                Confirm & Dispatch to Executive Team
              </button>
            </div>
          </div>
        </div>
      )}


      {isArchiveModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900/90 border border-slate-700/50 rounded-xl shadow-2xl max-w-4xl w-full flex flex-col h-[85vh]">
            <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/50 shrink-0">
              <h3 className="text-white font-bold flex items-center gap-2">
                <SafeIcon name="Archive" className="w-4 h-4 text-emerald-500" />
                Briefing Archive Viewer
              </h3>
              <button onClick={() => { setIsArchiveModalOpen(false); setSelectedArchiveItem(null); }} className="text-slate-400 hover:text-white transition-colors">
                <SafeIcon name="X" className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              <div className="w-1/3 border-r border-slate-700/50 bg-slate-800/30 overflow-y-auto">
                {isLoadingArchive ? (
                  <div className="p-8 flex justify-center"><SafeIcon name="Loader" className="w-6 h-6 text-emerald-500 animate-spin" /></div>
                ) : archiveItems.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500 italic">No archived briefings found.</div>
                ) : (
                  <ul className="divide-y divide-slate-700/50">
                    {archiveItems.map((item, idx) => (
                      <li key={idx}>
                        <button
                          onClick={() => setSelectedArchiveItem(item)}
                          className={`w-full text-left p-4 hover:bg-slate-800/80 transition-colors ${selectedArchiveItem?.key === item.key ? 'bg-slate-800/80 border-l-2 border-emerald-500' : ''}`}
                        >
                          <div className="text-sm font-bold text-emerald-400 font-mono flex items-center gap-2">
                             <SafeIcon name="FileText" className="w-3 h-3" />
                             {new Date(parseInt(item.key.split(':')[1])).toLocaleString()}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="w-2/3 bg-white overflow-hidden relative">
                {selectedArchiveItem ? (
                  <iframe
                     title="Archive Viewer"
                     className="w-full h-full border-0"
                     srcDoc={selectedArchiveItem.html}
                     sandbox=""
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-slate-900/50">
                     <SafeIcon name="Inbox" className="w-12 h-12 mb-4 opacity-20" />
                     <p className="text-sm">Select an archived briefing to view.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isAuditModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900/90 border border-slate-700/50 rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[80vh]">
                <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/50 shrink-0">
                    <h3 className="text-white font-bold flex items-center gap-2">
                        <SafeIcon name="List" className="w-4 h-4 text-emerald-500" />
                        Audit Trail Log Viewer
                    </h3>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleClearAuditLogs}
                            disabled={isClearingAudit}
                            className="px-3 py-1 bg-rose-500/20 text-rose-400 border border-rose-500/50 hover:bg-rose-500/40 rounded text-xs font-bold transition-colors disabled:opacity-50"
                        >
                            {isClearingAudit ? 'Clearing...' : 'Clear Audit Logs'}
                        </button>
                        <button onClick={() => setIsAuditModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                            <SafeIcon name="X" className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                {/* Toolbar */}
                <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/30 shrink-0">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-400">Filter:</label>
                    <select
                      value={actionTypeFilter}
                      onChange={(e) => setActionTypeFilter(e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="All Actions">All Actions</option>
                      <option value="audit-trigger">Audit Trigger</option>
                      <option value="session-renewal">Session Renewal</option>
                      <option value="circuit-reset">Circuit Reset</option>
                      <option value="signal-test">Signal Test</option>
                    </select>
                  </div>
                  <button
                    onClick={() => {
                      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(auditLogs, null, 2));
                      const downloadAnchorNode = document.createElement('a');
                      downloadAnchorNode.setAttribute("href", dataStr);
                      downloadAnchorNode.setAttribute("download", `green-machine-audit-trail-${new Date().toISOString()}.json`);
                      document.body.appendChild(downloadAnchorNode); // required for firefox
                      downloadAnchorNode.click();
                      downloadAnchorNode.remove();
                    }}
                    className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-sm hover:bg-emerald-500/20 transition-colors"
                  >
                    Download Audit Trail
                  </button>
                </div>
                <div className="p-4 flex-grow overflow-y-auto custom-scrollbar">
                    {isLoadingAuditLogs ? (
                        <div className="flex items-center justify-center p-8">
                            <SafeIcon name="Loader" className="w-6 h-6 text-emerald-500 animate-spin" />
                        </div>
                    ) : auditLogs.length > 0 ? (
                        <div className="space-y-3">
                            {auditLogs.map((log, idx) => (
                                <div key={idx} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-emerald-400 font-mono text-[10px] font-bold uppercase tracking-wider">
                                            {log.action}
                                        </span>
                                        <span className="text-slate-500 text-[10px] font-mono">
                                            {new Date(log.timestamp).toLocaleString()}
                                        </span>
                                    </div>
                                    <pre className="text-slate-300 text-xs font-mono whitespace-pre-wrap break-all bg-slate-900/50 p-2 rounded border border-slate-800">
                                        {JSON.stringify(log.details, null, 2)}
                                    </pre>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-slate-500 text-sm text-center italic p-8 bg-slate-800/30 rounded-lg border border-slate-800">
                            No audit logs found.
                        </div>
                    )}
                </div>
                <div className="p-4 border-t border-slate-700/50 bg-slate-800/50 flex justify-end shrink-0">
                    <button
                        onClick={() => fetchAuditLogs()}
                        disabled={isLoadingAuditLogs}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
                    >
                        <SafeIcon name="RefreshCw" className={`w-3 h-3 ${isLoadingAuditLogs ? 'animate-spin' : ''}`} />
                        Refresh Logs
                    </button>
                </div>
            </div>
          </div>
      )}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-slate-800 mt-12 bg-slate-900/30">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Worker: CF-DAL-01
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Mesh: Thirdweb L2
            </div>
          </div>
          <p className="text-slate-500 text-[10px] font-mono tracking-widest uppercase">
            &copy; 2026 AXIM CORE SYSTEMS // GREEN_MACHINE_V2_PROD
          </p>
        </div>
      </footer>

      {toastSuccess && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-emerald-500/90 text-white px-6 py-3 rounded-full shadow-2xl border border-emerald-400 z-50 animate-bounce font-bold tracking-wide">
          <div className="flex items-center gap-2">
            <SafeIcon name="CheckCircle" className="w-5 h-5" />
            {toastSuccess}
          </div>
        </div>
      )}
      {/* Verify Readiness Toast */}
      {readinessStatus && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-2xl border flex items-center gap-3 backdrop-blur-md transition-all duration-500 animate-in slide-in-from-bottom-5 ${readinessStatus.isOperational ? 'bg-emerald-900/90 border-emerald-500/50 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.3)]' : 'bg-amber-900/90 border-amber-500/50 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.3)]'}`}>
          <div className={`w-2 h-2 rounded-full animate-pulse ${readinessStatus.isOperational ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-wide">
              System Deployment: {readinessStatus.isOperational ? 'OPERATIONAL' : 'DEGRADED'}
            </span>
          </div>
        </div>
      )}

      {toastError && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900 border border-red-500/80 shadow-[0_4px_20px_rgba(225,29,72,0.4)] text-rose-100 px-4 py-3 rounded-lg flex items-center gap-3 transition-all duration-300">
          <SafeIcon name="AlertCircle" className="w-5 h-5 text-red-500" />
          <p className="text-sm font-bold tracking-wide">{toastError}</p>
        </div>
      )}
      {signalTestResult && (
        <div className="fixed bottom-20 right-4 z-50 bg-slate-900 border border-emerald-500/80 shadow-[0_4px_20px_rgba(16,185,129,0.4)] text-emerald-100 px-4 py-3 rounded-lg flex items-center gap-3 transition-all duration-300">
          <SafeIcon name="CheckCircle" className="w-5 h-5 text-emerald-500" />
          <p className="text-sm font-bold tracking-wide">{signalTestResult}</p>
        </div>
      )}
    </div>
  );
}

export default App;
