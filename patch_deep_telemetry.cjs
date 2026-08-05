const fs = require('fs');
let content = fs.readFileSync('src/components/planner/SystemDiagnosticsPanel.jsx', 'utf8');

const search = `              <pre className="text-[10px] text-slate-300 font-mono overflow-x-auto pt-6">
                {deepTelemetry ? JSON.stringify(deepTelemetry, null, 2) : 'Loading telemetry...'}
              </pre>`;

const replace = `              <div className="pt-6">
                {deepTelemetry?.investing_brain_telemetry?.model_usage && (
                  <div className="mb-4 bg-slate-800/50 p-2 rounded border border-slate-700/50">
                    <div className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider mb-2">AI Model Usage Breakdown</div>
                    <div className="flex justify-between items-center text-xs font-mono text-slate-300">
                      <span>Llama 3.1:</span>
                      <span className="font-bold">{deepTelemetry.investing_brain_telemetry.model_usage.llama_3_1_pct.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between items-center text-xs font-mono text-slate-300 mt-1">
                      <span>Mistral 7B:</span>
                      <span className="font-bold">{deepTelemetry.investing_brain_telemetry.model_usage.mistral_7b_pct.toFixed(1)}%</span>
                    </div>
                  </div>
                )}
                <pre className="text-[10px] text-slate-300 font-mono overflow-x-auto">
                  {deepTelemetry ? JSON.stringify(deepTelemetry, null, 2) : 'Loading telemetry...'}
                </pre>
              </div>`;

if (content.includes(search)) {
    content = content.replace(search, replace);
    fs.writeFileSync('src/components/planner/SystemDiagnosticsPanel.jsx', content);
    console.log("Patched");
} else {
    console.log("Not found");
}
