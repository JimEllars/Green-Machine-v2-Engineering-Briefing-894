const fs = require('fs');

let content = fs.readFileSync('src/App.jsx', 'utf8');

// Import AXiMLoginGate
content = content.replace(
  "import AffiliatePayoutGrid from './components/planner/AffiliatePayoutGrid';",
  "import AffiliatePayoutGrid from './components/planner/AffiliatePayoutGrid';\nimport AXiMLoginGate from './components/auth/AXiMLoginGate';"
);

// Add logout handler
content = content.replace(
  "function App() {",
  `function App() {\n  const [userEmail, setUserEmail] = useState('');\n\n  const handleLogout = async () => {\n    await supabase.auth.signOut();\n    setAuthState('Guest Mode');\n  };\n\n  useEffect(() => {\n    const session = getSessionState();\n    if (session?.user?.email) {\n      setUserEmail(session.user.email);\n    }\n    const unsubscribe = subscribeToAuth((event, session) => {\n      setAuthState(session ? 'Authenticated' : 'Guest Mode');\n      if (session?.user?.email) {\n        setUserEmail(session.user.email);\n      } else {\n        setUserEmail('');\n      }\n    });\n    return () => unsubscribe();\n  }, []);\n`
);

// Modify return to return AXiMLoginGate conditionally
// We'll replace the main return and nav bar.
const returnStartIndex = content.indexOf('  return (\n    <div className="min-h-screen bg-zinc-950');
if (returnStartIndex === -1) {
  console.log("Could not find return statement in App.jsx");
  process.exit(1);
}

const beforeReturn = content.slice(0, returnStartIndex);
const afterReturn = content.slice(returnStartIndex);

const authWrapper = `
  if (authState !== 'Authenticated') {
    return <AXiMLoginGate />;
  }

`;

content = beforeReturn + authWrapper + afterReturn;

// Now let's modify the nav bar
const navStart = content.indexOf('<nav className="border-b border-zinc-800');
const navEnd = content.indexOf('</nav>') + '</nav>'.length;
const oldNav = content.slice(navStart, navEnd);

const newNav = `<nav className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                <SafeIcon name="Hexagon" className="text-slate-900 w-5 h-5" />
              </div>
              <div>
                <h1 className="font-bold tracking-tight text-white leading-none">AXiM Control Center</h1>
                <span className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">The Green Machine v2</span>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
              <a href="#" className="text-white">Dashboard</a>
              <a href="#" className="hover:text-white transition-colors">Ledger</a>
              <a href="#" className="hover:text-white transition-colors">Market Cache</a>
              <a href="#" className="hover:text-white transition-colors">AI Strategies</a>
            </div>

            <div className={\`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors \${dlqStatus.active ? 'bg-amber-500/10 border-amber-500/50 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-300'}\`}>
              <div className={\`w-2 h-2 rounded-full \${dlqStatus.active ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}\`} />
              Edge Buffer Status {dlqStatus.active && \`(\${dlqStatus.count})\`}
            </div>

            <div className="flex items-center gap-4">
               <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-md border border-slate-700 text-xs text-slate-300">
                <SafeIcon name="Lock" className="w-3.5 h-3.5 text-emerald-400" />
                {userEmail || 'axim_internal_finance'}
              </div>
              <button onClick={handleLogout} className="px-3 py-1.5 text-xs font-medium text-white bg-red-500/20 border border-red-500/50 rounded hover:bg-red-500/30 transition-colors flex items-center gap-2">
                <SafeIcon name="LogOut" className="w-3.5 h-3.5" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>`;

content = content.replace(oldNav, newNav);

fs.writeFileSync('src/App.jsx', content, 'utf8');
console.log('App.jsx patched successfully');
