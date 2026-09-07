import React, { useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import SafeIcon from '../../common/SafeIcon';

const AXiMLoginGate = () => {
  const [initialAuthChecked, setInitialAuthChecked] = React.useState(false);
  const [isRefreshingToken, setIsRefreshingToken] = React.useState(false);
  const [isOffline, setIsOffline] = React.useState(!navigator.onLine);


  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) {
        // Silently update cache without triggering unmounts
        try {
          localStorage.setItem('axim_offline_session', JSON.stringify({ active: true, timestamp: Date.now() }));
        } catch(e) { /* ignore */ }
      }
    });
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);


  useEffect(() => {
    let offlineTimeout;
    const handleOnline = () => {
       clearTimeout(offlineTimeout);
       setIsOffline(false);
    };
    const handleOffline = () => {
       offlineTimeout = setTimeout(() => setIsOffline(true), 500);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      clearTimeout(offlineTimeout);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let token = params.get('token');
    if (token) sessionStorage.setItem('axim_sso_token_backup', token);
    else token = sessionStorage.getItem('axim_sso_token_backup');

    const initializeAuth = async () => {
      setIsRefreshingToken(true);
      if (token) {
        // Hydrate the local React/Supabase session seamlessly
        const { error } = await supabase.auth.setSession({
          access_token: token,
          refresh_token: token,
        });


        if (error) {
           console.error("Session hydration failed:", error);
        } else {
           // Validate email against whitelist
           const { data: sessionData } = await supabase.auth.getSession();
           const email = sessionData?.session?.user?.email;
           const whitelist = ["jrellars@gmail.com", "authorized@axim.us.com"];
           if (email && !whitelist.includes(email)) {
             await supabase.auth.signOut();
             alert("Unauthorized email address. Only internal treasury managers are allowed.");
             window.location.href = `https://passport.axim.us.com/login?redirect=${encodeURIComponent(window.location.origin + '/auth/callback')}`;
             return;
           }
        }


        // Strip token from history to prevent token leakage
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        sessionStorage.removeItem('axim_sso_token_backup');
        setInitialAuthChecked(true);
      } else {
        // If we have an existing session and just network issue, don't redirect
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
           setInitialAuthChecked(true);
           try {
             // Cache a minimal session representation for offline reloads
             localStorage.setItem('axim_offline_session', JSON.stringify({ active: true, timestamp: Date.now() }));
           } catch(e) { /* ignore */ }
        } else {
           let cachedOffline = false;
           try {
               const stored = localStorage.getItem('axim_offline_session');
               if (stored) {
                   const parsed = JSON.parse(stored);
                   // Accept cached session if within 24 hours
                   if (Date.now() - parsed.timestamp < 86400000) cachedOffline = true;
               }
           } catch(e) { /* ignore */ }

           if (isOffline || cachedOffline) {
             setInitialAuthChecked(true);
           } else {
             // Automatically route the user to SSO
             const redirectUrl = encodeURIComponent(window.location.origin + '/auth/callback');
             window.location.href = `https://passport.axim.us.com/login?redirect=${redirectUrl}`;
           }
        }
      }
      setIsRefreshingToken(false);
    };

    initializeAuth();
  }, []);

  if (isOffline && initialAuthChecked) {
    return null; // Return nothing so the main app can handle the render when offline but logged in.
  }


  return (
    <div className="min-h-screen bg-black text-emerald-400 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900/80 backdrop-blur-xl border border-zinc-700/50 shadow-2xl rounded-2xl p-8 overflow-hidden relative">
        <div className="absolute -top-32 -left-32 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />

        <div className="relative z-10">
          <div className="text-center flex flex-col items-center">
            <div className="bg-emerald-500/20 p-3 rounded-full mb-4 border border-emerald-500/30">
              <SafeIcon name="Shield" className="w-8 h-8 text-emerald-400 animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">AXiM Enterprise SSO</h1>
            <p className="text-zinc-400 mt-2 flex items-center gap-2">
              <SafeIcon name="Loader" className="w-4 h-4 animate-spin text-emerald-500" />
              Authenticating... <div className="w-32 h-2 mt-4 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 animate-pulse w-1/2"></div></div>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AXiMLoginGate;
