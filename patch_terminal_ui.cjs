const fs = require('fs');
const file = 'src/components/planner/StrategyConsultantTerminal.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl flex flex-col h-\[600px\] relative overflow-hidden"/g, 'className="bg-slate-900/90 backdrop-blur-xl border border-slate-700 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col h-[600px] relative overflow-hidden"');

content = content.replace(/<div className="flex justify-between items-center bg-slate-800 p-4 border-b border-slate-700">/g, '<div className="flex justify-between items-center bg-slate-800/80 backdrop-blur-md p-4 border-b border-slate-700 shadow-sm z-10">');

content = content.replace(/className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/g, 'className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"');

content = content.replace(/className="p-6 flex-1 overflow-y-auto font-mono text-sm leading-relaxed relative custom-scrollbar"/g, 'className="p-6 flex-1 overflow-y-auto font-mono text-sm leading-relaxed relative custom-scrollbar bg-slate-900/50 backdrop-blur-sm"');

fs.writeFileSync(file, content);
