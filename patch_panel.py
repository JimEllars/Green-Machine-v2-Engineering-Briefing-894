import re

with open("src/components/planner/SystemDiagnosticsPanel.jsx", "r") as f:
    content = f.read()

# Insert the compute debt visualization panel
# We'll put it right after the Fin-Ops Margin Ratio div

compute_debt_panel = """
        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <span className="text-sm text-slate-300">Fin-Ops Margin Ratio</span>
          <span className={`text-lg font-bold drop-shadow-md ${((txCount / (txCount + (dlqStatus?.count || 0) + 1)) * 100) >= 95 ? 'text-emerald-500' : 'text-amber-500'}`}>
            {((txCount / (txCount + (dlqStatus?.count || 0) + 1)) * 100).toFixed(1)}%
          </span>
        </div>

        {/* Self-Funding Ratio per Micro-App Panel */}
        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 mt-4 mb-4">
          <div className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
            <SafeIcon name="Zap" className="w-4 h-4 text-emerald-500" /> Self-Funding Ratio (Live)
          </div>
          <div className="flex flex-col gap-3">
            {computeDebt && computeDebt.length > 0 ? (
              computeDebt.map((appData, idx) => {
                const ratioPct = Math.min(Math.max((appData.ratio || 0) * 100, 0), 100);
                const isHealthy = appData.ratio < 0.2; // arbitrary healthy threshold
                const isWarning = appData.ratio >= 0.2 && appData.ratio < 0.5;

                return (
                  <div key={idx} className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">{appData.app}</span>
                      <span className={`text-[10px] font-mono font-bold ${isHealthy ? 'text-emerald-400' : isWarning ? 'text-amber-400' : 'text-rose-400'}`}>
                        {ratioPct.toFixed(1)}% Debt Ratio
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${isHealthy ? 'bg-emerald-500' : isWarning ? 'bg-amber-500' : 'bg-rose-500'}`}
                        style={{ width: `${ratioPct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-slate-500 font-mono italic">No compute debt data available.</div>
            )}
          </div>
        </div>
"""

# Replace the original Fin-Ops Margin Ratio div with the updated string containing both
pattern = r'<div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">\s*<span className="text-sm text-slate-300">Fin-Ops Margin Ratio</span>\s*<span className=\{`text-lg font-bold drop-shadow-md \$\{[\s\S]*?\}%?\s*</span>\s*</div>'

content = re.sub(pattern, compute_debt_panel.strip(), content)

with open("src/components/planner/SystemDiagnosticsPanel.jsx", "w") as f:
    f.write(content)
