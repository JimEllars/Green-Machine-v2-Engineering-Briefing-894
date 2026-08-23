const fs = require('fs');

// Patch MarketFeedMatrix.jsx
let marketFeed = fs.readFileSync('src/components/planner/MarketFeedMatrix.jsx', 'utf8');
marketFeed = marketFeed.replace(
  `bg-slate-800/50 rounded-lg p-4 border border-slate-700/50 hover:border-slate-600`,
  `bg-slate-800/80 rounded-xl p-5 border border-slate-700 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-900/20`
);
fs.writeFileSync('src/components/planner/MarketFeedMatrix.jsx', marketFeed);

// Patch StrategyConsultantTerminal.jsx
let terminal = fs.readFileSync('src/components/planner/StrategyConsultantTerminal.jsx', 'utf8');
terminal = terminal.replace(
  `bg-slate-900/60 border border-slate-700/50 shadow-lg backdrop-blur-md`,
  `bg-slate-900/80 border border-slate-700 shadow-xl backdrop-blur-xl`
);
terminal = terminal.replace(
  `bg-slate-900 border-t border-slate-800`,
  `bg-slate-900/90 border-t border-slate-700/50 p-5 rounded-b-xl`
);
fs.writeFileSync('src/components/planner/StrategyConsultantTerminal.jsx', terminal);

// Patch AffiliatePayoutGrid.jsx
let payout = fs.readFileSync('src/components/planner/AffiliatePayoutGrid.jsx', 'utf8');
payout = payout.replace(
  `bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/50 rounded-xl p-6 shadow-2xl`,
  `bg-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-xl p-6 shadow-2xl overflow-hidden`
);
fs.writeFileSync('src/components/planner/AffiliatePayoutGrid.jsx', payout);

console.log('UI components patched.');
