const fs = require('fs');

const path = 'src/App.jsx';
let content = fs.readFileSync(path, 'utf8');

// Add import
content = content.replace("import { supabase } from './supabaseClient';", "import { supabase, subscribeToAuth, getSessionState } from './supabaseClient';");

// Add state for auth
content = content.replace("const [dlqStatus, setDlqStatus] = useState({", "const [authState, setAuthState] = useState(getSessionState() ? 'Authenticated' : 'Guest Mode');\n  const [dlqStatus, setDlqStatus] = useState({");

// Add useEffect for auth
content = content.replace(
`  useEffect(() => {
    fetchAuditLogs();
  }, []);`,
`  useEffect(() => {
    fetchAuditLogs();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((event, session) => {
      setAuthState(session ? 'Authenticated' : 'Guest Mode');
    });
    return () => unsubscribe();
  }, []);`);

// Add UI
content = content.replace(
`          <div className="h-10 w-px bg-zinc-800 hidden md:block"></div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Oracle Link</div>`,
`          <div className="h-10 w-px bg-zinc-800 hidden md:block"></div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Auth Session</div>
            <div className={\`text-sm font-bold flex items-center gap-2 \${authState === 'Authenticated' ? 'text-emerald-400' : 'text-amber-400'}\`}>
              {authState === 'Authenticated' ? (
                 <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              ) : (
                 <div className="w-2 h-2 rounded-full bg-amber-500" />
              )}
              {authState}
            </div>
          </div>
          <div className="h-10 w-px bg-zinc-800 hidden md:block"></div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Oracle Link</div>`);

fs.writeFileSync(path, content, 'utf8');
