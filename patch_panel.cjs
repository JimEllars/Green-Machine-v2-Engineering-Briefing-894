const fs = require('fs');

const path = 'src/components/planner/SystemDiagnosticsPanel.jsx';
let content = fs.readFileSync(path, 'utf8');

const replacement = `
                {deepTelemetry?.edge_telemetry?.kv_cache_ratio && (
                  <div className="mb-4 bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                    <div className="flex justify-between items-center mb-3">
                      <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider flex items-center gap-2">
                        <SafeIcon name="Database" className="w-3 h-3" />
                        KV Cache Hit-Rate
                      </div>
                      <div className="text-[10px] font-mono font-bold text-slate-300">
                        {deepTelemetry.edge_telemetry.kv_cache_ratio}
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                      <div className={\`h-full transition-all \${
                        parseFloat(deepTelemetry.edge_telemetry.kv_cache_ratio) > 90 ? 'bg-emerald-500' :
                        parseFloat(deepTelemetry.edge_telemetry.kv_cache_ratio) >= 70 ? 'bg-amber-500' :
                        'bg-rose-500'
                      }\`} style={{ width: deepTelemetry.edge_telemetry.kv_cache_ratio }} />
                    </div>
                  </div>
                )}

                {deepTelemetry?.investing_brain_telemetry && (`;

content = content.replace('{deepTelemetry?.investing_brain_telemetry && (', replacement);

fs.writeFileSync(path, content, 'utf8');
