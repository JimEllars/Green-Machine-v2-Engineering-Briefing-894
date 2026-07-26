import re

file_path = "src/components/planner/MarketFeedMatrix.jsx"
with open(file_path, "r") as f:
    content = f.read()

search_html = r"""            \{asset\.cfo_state && \(
              <div className="mt-3 flex justify-end">
                <span className=\{`text-xs font-bold px-2 py-1 rounded-md \$\{
                  asset\.cfo_state === 'accumulate' \? 'bg-\[#3ca691\]/20 text-\[#3ca691\] border border-\[#3ca691\]/30 shadow-\[0_0_8px_rgba\(60,166,145,0\.4\)\]' :
                  asset\.cfo_state === 'wait' \? 'bg-\[#6B6588\]/20 text-\[#6B6588\] border border-\[#6B6588\]/30 shadow-\[0_0_8px_rgba\(107,101,136,0\.4\)\]' :
                  asset\.cfo_state === 'distribute' \? 'bg-\[#B767DE\]/20 text-\[#B767DE\] border border-\[#B767DE\]/30 shadow-\[0_0_8px_rgba\(183,103,222,0\.4\)\]' :
                  'bg-slate-700/50 text-slate-400'
                \}\}`\}>
                  CFO: \{asset\.cfo_state === 'accumulate' \? 'Accumulate' : asset\.cfo_state === 'wait' \? 'Neutral' : asset\.cfo_state === 'distribute' \? 'Distribute' : asset\.cfo_state\}
                </span>
              </div>
            \)\}"""

replace_html = """            {asset.cfo_state && (
              <div className="mt-3 flex justify-end relative group cursor-help">
                <span className={`text-xs font-bold px-2 py-1 rounded-md transition-colors ${
                  asset.cfo_state === 'accumulate' ? 'bg-[#3ca691]/20 text-[#3ca691] border border-[#3ca691]/30 shadow-[0_0_8px_rgba(60,166,145,0.4)] group-hover:bg-[#3ca691]/30' :
                  asset.cfo_state === 'wait' ? 'bg-[#6B6588]/20 text-[#6B6588] border border-[#6B6588]/30 shadow-[0_0_8px_rgba(107,101,136,0.4)] group-hover:bg-[#6B6588]/30' :
                  asset.cfo_state === 'distribute' ? 'bg-[#B767DE]/20 text-[#B767DE] border border-[#B767DE]/30 shadow-[0_0_8px_rgba(183,103,222,0.4)] group-hover:bg-[#B767DE]/30' :
                  'bg-slate-700/50 text-slate-400 group-hover:bg-slate-700'
                }`}>
                  CFO: {asset.cfo_state === 'accumulate' ? 'Accumulate' : asset.cfo_state === 'wait' ? 'Neutral' : asset.cfo_state === 'distribute' ? 'Distribute' : asset.cfo_state}
                </span>

                {/* Hover Popover */}
                <div className="absolute bottom-full right-0 mb-2 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 translate-y-2 group-hover:translate-y-0">
                  <div className="bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/50 p-3 rounded-lg shadow-2xl text-left">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Asset CFO State</div>
                    <div className={`font-bold text-sm mb-2 ${
                      asset.cfo_state === 'accumulate' ? 'text-[#3ca691]' :
                      asset.cfo_state === 'wait' ? 'text-[#6B6588]' :
                      asset.cfo_state === 'distribute' ? 'text-[#B767DE]' :
                      'text-slate-300'
                    }`}>
                      {asset.cfo_state === 'accumulate' ? 'Accumulate' : asset.cfo_state === 'wait' ? 'Neutral' : asset.cfo_state === 'distribute' ? 'Distribute' : asset.cfo_state}
                    </div>

                    {asset.high_24h !== undefined && asset.low_24h !== undefined && (
                      <>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 mt-2">24H Range</div>
                        <div className="flex justify-between text-xs font-mono text-slate-300 bg-black/30 p-1.5 rounded">
                          <span className="text-rose-400">${asset.low_24h.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                          <span className="text-slate-500">-</span>
                          <span className="text-emerald-400">${asset.high_24h.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                        </div>
                      </>
                    )}

                    <div className="mt-3 pt-2 border-t border-zinc-700/50 text-[9px] text-slate-500 italic text-right">
                      Sourced via Anny Trade REST
                    </div>
                  </div>
                  {/* Tooltip arrow */}
                  <div className="absolute top-full right-4 -mt-px border-4 border-transparent border-t-zinc-700/50" />
                </div>
              </div>
            )}"""

content = re.sub(search_html, replace_html, content)

with open(file_path, "w") as f:
    f.write(content)
print("Patch applied to MarketFeedMatrix.jsx.")
