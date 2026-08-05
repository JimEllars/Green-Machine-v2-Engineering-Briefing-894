const fs = require('fs');
let content = fs.readFileSync('src/App.jsx', 'utf8');

const stateSearch = `  const [isTestingSignal, setIsTestingSignal] = useState(false);`;
const stateReplace = `  const [isTestingSignal, setIsTestingSignal] = useState(false);
  const [testSymbol, setTestSymbol] = useState('BTC');
  const [testAmountUsdt, setTestAmountUsdt] = useState(500);`;
content = content.replace(stateSearch, stateReplace);

const handleSearch = `  const handleTestSignal = async () => {
    setIsTestingSignal(true);
    setSignalTestResult(null);
    setFullSignalResult(null);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(\`\${workerUrl}/api/admin/validate-signal\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        },
        body: JSON.stringify({ symbol: 'BTC', action: 'buy', amount_usdt: 500 })
      });`;
const handleReplace = `  const handleTestSignal = async () => {
    setIsTestingSignal(true);
    setSignalTestResult(null);
    setFullSignalResult(null);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(\`\${workerUrl}/api/admin/validate-signal\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        },
        body: JSON.stringify({ symbol: testSymbol, action: 'buy', amount_usdt: Number(testAmountUsdt) })
      });`;
content = content.replace(handleSearch, handleReplace);

const uiSearch = `                <button
                  onClick={handleTestSignal}
                  className={\`p-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg border border-slate-700/50 text-[10px] font-bold text-slate-300 transition-colors uppercase tracking-wider \${isTestingSignal ? 'opacity-50 cursor-not-allowed' : ''}\`}
                >
                  {isTestingSignal ? 'Testing...' : 'Test Pre-Flight Signal'}
                </button>
              </div>`;

const uiReplace = `              </div>
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
                    className={\`p-2.5 bg-slate-800/50 hover:bg-slate-800 rounded border border-slate-700/50 text-xs font-bold text-slate-300 transition-colors uppercase tracking-wider h-[38px] \${isTestingSignal ? 'opacity-50 cursor-not-allowed' : ''}\`}
                  >
                    {isTestingSignal ? 'Testing...' : 'Test Pre-Flight Signal'}
                  </button>
              </div>`;

content = content.replace(uiSearch, uiReplace);


fs.writeFileSync('src/App.jsx', content);
