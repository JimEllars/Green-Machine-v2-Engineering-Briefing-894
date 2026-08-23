const fs = require('fs');
const file = 'src/components/planner/AffiliatePayoutGrid.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden flex flex-col h-\[600px\]"/g, 'className="bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.3)] overflow-hidden flex flex-col h-[600px]"');

content = content.replace(/className="bg-slate-800 p-4 border-b border-slate-700 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4"/g, 'className="bg-slate-800/80 backdrop-blur-md p-4 border-b border-slate-700 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 z-10"');

content = content.replace(/className="w-full text-left text-sm whitespace-nowrap"/g, 'className="w-full text-left text-sm whitespace-nowrap transition-all duration-300"');

content = content.replace(/<thead className="bg-slate-800\/50 text-slate-400">/g, '<thead className="bg-slate-800/80 backdrop-blur-sm text-slate-400 shadow-sm">');

fs.writeFileSync(file, content);
