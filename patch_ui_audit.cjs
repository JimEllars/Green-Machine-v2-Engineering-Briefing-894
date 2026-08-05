const fs = require('fs');

let content = fs.readFileSync('src/App.jsx', 'utf8');

const searchFn = `  const [actionTypeFilter, setActionTypeFilter] = useState('All Actions');`;
const replaceFn = `  const [actionTypeFilter, setActionTypeFilter] = useState('All Actions');

  const [isClearingAudit, setIsClearingAudit] = useState(false);
  const handleClearAuditLogs = async () => {
    setIsClearingAudit(true);
    try {
      const workerUrl = getWorkerUrl();
      const res = await fetch(\`\${workerUrl}/api/admin/audit-logs\`, {
        method: 'DELETE',
        headers: {
          'X-Axim-Signature': import.meta.env.VITE_AXIM_INTERNAL_KEY || ''
        }
      });
      if (res.ok) {
        setAuditLogs([]);
        setToastError('Logs Purged');
        setTimeout(() => setToastError(''), 3000);
      } else {
        setToastError('Failed to clear audit logs');
        setTimeout(() => setToastError(''), 3000);
      }
    } catch (e) {
      setToastError('Failed to clear audit logs');
      setTimeout(() => setToastError(''), 3000);
    } finally {
      setIsClearingAudit(false);
    }
  };`;
content = content.replace(searchFn, replaceFn);


const searchBtn = `                    <h3 className="text-white font-bold flex items-center gap-2">
                        <SafeIcon name="List" className="w-4 h-4 text-emerald-500" />
                        Audit Trail Log Viewer
                    </h3>
                    <button onClick={() => setIsAuditModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                        <SafeIcon name="X" className="w-4 h-4" />
                    </button>
                </div>`;

const replaceBtn = `                    <h3 className="text-white font-bold flex items-center gap-2">
                        <SafeIcon name="List" className="w-4 h-4 text-emerald-500" />
                        Audit Trail Log Viewer
                    </h3>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleClearAuditLogs}
                            disabled={isClearingAudit}
                            className="px-3 py-1 bg-rose-500/20 text-rose-400 border border-rose-500/50 hover:bg-rose-500/40 rounded text-xs font-bold transition-colors disabled:opacity-50"
                        >
                            {isClearingAudit ? 'Clearing...' : 'Clear Audit Logs'}
                        </button>
                        <button onClick={() => setIsAuditModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                            <SafeIcon name="X" className="w-4 h-4" />
                        </button>
                    </div>
                </div>`;

content = content.replace(searchBtn, replaceBtn);

fs.writeFileSync('src/App.jsx', content);
