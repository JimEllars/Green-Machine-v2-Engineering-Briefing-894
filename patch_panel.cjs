const fs = require('fs');

const path = 'src/components/planner/SystemDiagnosticsPanel.jsx';
let code = fs.readFileSync(path, 'utf8');

// Use the new fields exposed from hook
const hookOld = "  const { telemetry: sysTelemetry, telemetryHistory, latencyMs: sysLatency, status: sysStatus, isFetching: sysIsFetching, computeDebt, emailServiceStatus, triggerTestEmail, emailService, verifyEmailDelivery } = useSystemDiagnostics();";
const hookNew = "  const { telemetry: sysTelemetry, telemetryHistory, latencyMs: sysLatency, status: sysStatus, isFetching: sysIsFetching, computeDebt, emailServiceStatus, triggerTestEmail, emailService, verifyEmailDelivery, diagnostics, diagnosticsLoading, diagnosticsError, isLiveSyncing, refreshDiagnostics } = useSystemDiagnostics();";

code = code.replace(hookOld, hookNew);


// We need to inject the Diagnostics panel into the render
// Look for where to insert it. We'll find a good spot, maybe before Webhook Replay Tool or replacing a part.
// Actually let's just create a new section at the top of the Deep Telemetry block if `diagnostics` exists.

const telemetryHeader = `                <pre className="text-[10px] text-slate-300 font-mono overflow-x-auto">
                  {deepTelemetry ? JSON.stringify(deepTelemetry, null, 2) : 'Loading telemetry...'}
                </pre>`;

const diagnosticsSection = `
                {diagnostics && (
                  <div className="mb-4 bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
                    <div className="flex justify-between items-center mb-4">
                      <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-2">
                        <SafeIcon name="Activity" className="w-3 h-3" />
                        Live Edge Diagnostics
                      </div>
                      <div className="flex items-center gap-2">
                        {isLiveSyncing && <SafeIcon name="Loader" className="w-3 h-3 text-emerald-500 animate-spin" />}
                        <button onClick={refreshDiagnostics} disabled={isLiveSyncing} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-[10px] text-white">Refresh</button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-slate-900 p-2 rounded border border-slate-700">
                        <div className="text-[9px] text-slate-500 font-mono uppercase mb-1">Status</div>
                        <div className="flex items-center gap-2">
                          <div className={\`w-2 h-2 rounded-full \${diagnostics.status === 'operational' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'}\`} />
                          <span className="text-xs text-slate-200 font-bold capitalize">{diagnostics.status}</span>
                        </div>
                      </div>
                      <div className="bg-slate-900 p-2 rounded border border-slate-700">
                        <div className="text-[9px] text-slate-500 font-mono uppercase mb-1">Region (Colo)</div>
                        <div className="text-xs text-slate-200 font-bold">{diagnostics.region}</div>
                      </div>
                      <div className="bg-slate-900 p-2 rounded border border-slate-700">
                        <div className="text-[9px] text-slate-500 font-mono uppercase mb-1">DB Pool Latency</div>
                        <div className="flex items-center gap-2">
                          <div className={\`w-1.5 h-1.5 rounded-full \${diagnostics.latency.database_ms < 150 ? 'bg-emerald-500' : diagnostics.latency.database_ms < 500 ? 'bg-amber-500' : 'bg-rose-500'}\`} />
                          <span className="text-xs text-slate-200 font-bold">{diagnostics.latency.database_ms}ms</span>
                        </div>
                      </div>
                      <div className="bg-slate-900 p-2 rounded border border-slate-700">
                        <div className="text-[9px] text-slate-500 font-mono uppercase mb-1">Workers AI Engine</div>
                        <div className="flex items-center gap-2">
                          <div className={\`w-1.5 h-1.5 rounded-full \${diagnostics.services.workers_ai === 'available' ? 'bg-emerald-500' : 'bg-rose-500'}\`} />
                          <span className="text-xs text-slate-200 font-bold capitalize">{diagnostics.services.workers_ai.replace('_', ' ')}</span>
                        </div>
                      </div>
                      <div className="bg-slate-900 p-2 rounded border border-slate-700 col-span-2">
                        <div className="text-[9px] text-slate-500 font-mono uppercase mb-1">KV Cache Health</div>
                        <div className="flex items-center gap-2">
                          <div className={\`w-1.5 h-1.5 rounded-full \${diagnostics.services.kv_ledger.includes('ready') ? 'bg-emerald-500' : 'bg-rose-500'}\`} />
                          <span className="text-xs text-slate-200 font-bold capitalize">{diagnostics.services.kv_ledger.replace('_', ' ')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-400 font-mono border-t border-slate-700/50 pt-3">
                      <div className="mb-2 font-bold text-indigo-400">Edge Event Stream</div>
                      <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                         {/* We fake an event stream using the current payload as the latest event, since full history isn't stored locally in the basic diagnostic structure */}
                         <div className="flex items-center gap-2 bg-slate-900/50 p-1 rounded border border-slate-800">
                           <span className="text-emerald-500 font-bold">[{new Date(diagnostics.timestamp).toLocaleTimeString()}]</span>
                           <span className="text-slate-300">Ping to {diagnostics.region} returned {diagnostics.status} (DB: {diagnostics.latency.database_ms}ms)</span>
                         </div>
                      </div>
                    </div>
                  </div>
                )}
`;

code = code.replace(telemetryHeader, diagnosticsSection + "\n" + telemetryHeader);


// Wrap the entire component content logic inside ComponentErrorBoundary (it might already be inside one from the parent, but let's just make sure we don't break existing stuff)

fs.writeFileSync(path, code);
console.log("Panel patched");
