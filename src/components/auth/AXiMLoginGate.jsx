import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import SafeIcon from '../../common/SafeIcon';

const AXiMLoginGate = () => {
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      // Simulate session hydration
      window.localStorage.setItem('sb-token', token);

      // Strip token from history
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);

      // Force reload or state update to reflect authenticated state
      window.location.reload();
    }
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSSOLoading, setIsSSOLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
    } catch (error) {
      setErrorMsg(error.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };


  const handleSSOLogin = (e) => {
    e.preventDefault();
    setIsSSOLoading(true);
    const redirectUrl = encodeURIComponent(window.location.origin + '/auth/callback');
    window.location.href = `https://passport.axim.us.com?redirect=${redirectUrl}`;
  };


  return (
    <div className="min-h-screen bg-black text-emerald-400 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900/80 backdrop-blur-xl border border-zinc-700/50 shadow-2xl rounded-2xl p-8 overflow-hidden relative">
        {/* Glassmorphic decorative effects */}
        <div className="absolute -top-32 -left-32 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />

        <div className="relative z-10">
          <div className="text-center mb-8 flex flex-col items-center">
            <div className="bg-emerald-500/20 p-3 rounded-full mb-4 border border-emerald-500/30">
              <SafeIcon name="Lock" className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">AXiM Green Machine</h1>
            <p className="text-zinc-400 mt-1">Internal Control Center</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">AXiM Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-950/50 border border-zinc-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                placeholder="operative@axim.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">Passcode</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-950/50 border border-zinc-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                placeholder="••••••••"
                required
              />
            </div>

            {errorMsg && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-sm px-4 py-3 rounded-lg flex items-center gap-2">
                <SafeIcon name="AlertCircle" className="w-4 h-4 flex-shrink-0" />
                <p>{errorMsg}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || isSSOLoading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <SafeIcon name="Loader" className="w-5 h-5 animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <SafeIcon name="LogIn" className="w-5 h-5" />
                  Secure Access
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleSSOLogin}
              disabled={isSSOLoading || isLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 px-4 rounded-lg shadow-[0_0_15px_rgba(79,70,229,0.3)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSSOLoading ? (
                <>
                  <SafeIcon name="Loader" className="w-5 h-5 animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <SafeIcon name="Shield" className="w-5 h-5" />
                  AXiM Enterprise SSO
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AXiMLoginGate;
