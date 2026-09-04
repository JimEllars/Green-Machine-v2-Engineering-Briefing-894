import re

with open("src/components/planner/TradeExecutionLedger.jsx", "r") as f:
    content = f.read()

# Update the status text in the table from Pending to Confirmed / Submitted based on transaction_hash existence
# and add a link to Arbiscan.

search = """
                      {trade.transaction_hash ? (
                        <a
                          href={`https://arbiscan.io/tx/${trade.transaction_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 font-mono text-xs underline"
                        >
                          {trade.transaction_hash.substring(0, 6)}...{trade.transaction_hash.substring(trade.transaction_hash.length - 4)}
                        </a>
                      ) : (
                        <span className="text-zinc-600 font-mono text-xs">Pending</span>
                      )}
"""

replace = """
                      {trade.transaction_hash ? (
                        <div className="flex flex-col items-end gap-1">
                          <a
                            href={`https://arbiscan.io/tx/${trade.transaction_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-mono text-xs underline"
                          >
                            [Tx: {trade.transaction_hash.substring(0, 6)}...{trade.transaction_hash.substring(trade.transaction_hash.length - 4)}]
                          </a>
                          {trade.status === 'confirmed' ? (
                             <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded animate-pulse">
                               <SafeIcon name="CheckCircle" className="w-3 h-3" /> Confirmed
                             </span>
                          ) : (
                             <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                               <SafeIcon name="Clock" className="w-3 h-3" /> {trade.status || 'Submitted'}
                             </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-600 font-mono text-xs">Pending</span>
                      )}
"""

content = content.replace(search, replace)

if "SafeIcon" not in content and "import SafeIcon" not in content:
   content = content.replace("import { BanknotesIcon, ArrowTrendingUpIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';", "import { BanknotesIcon, ArrowTrendingUpIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';\nimport * as Icons from 'lucide-react';\n\nconst SafeIcon = ({ name, className }) => {\n  const IconComponent = Icons[name];\n  if (!IconComponent) return null;\n  return <IconComponent className={className} />;\n};\n")

with open("src/components/planner/TradeExecutionLedger.jsx", "w") as f:
    f.write(content)
