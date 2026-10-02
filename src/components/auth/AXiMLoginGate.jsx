import React, { useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import SafeIcon from '../../common/SafeIcon';

const AXiMLoginGate = () => {
  const [initialAuthChecked, setInitialAuthChecked] = React.useState(false);
  const [isRefreshingToken, setIsRefreshingToken] = React.useState(false);
  const [isOffline, setIsOffline] = React.useState(!navigator.onLine);


  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        // Prevent unmount loops if the app receives a late signed_in event
        if (initialAuthChecked) return;
      }
      if (event === 'TOKEN_REFRESHED' && session) {
        // Silently update cache without triggering unmounts
        try {
          localStorage.setItem('axim_offline_session', JSON.stringify({ active: true, timestamp: Date.now() }));
        } catch(e) { /* ignore */ }
      } else if (event === 'SIGNED_OUT') {
        // Debounce signout to prevent flickers caused by network fluctuations
        if (window._axim_signout_debounce) clearTimeout(window._axim_signout_debounce);
        window._axim_signout_debounce = setTimeout(() => {
        // Handle signed out events gracefully, check if we have a valid offline cache before hard redirect
        let cachedOffline = false;
        try {
            const stored = localStorage.getItem('axim_offline_session');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Date.now() - parsed.timestamp < 300000) cachedOffline = true;
            }
        } catch(e) { /* ignore */ }

        if (!cachedOffline && !isOffline) {
          const redirectUrl = encodeURIComponent(window.location.origin + '/auth/callback');
          window.location.href = `https://passport.axim.us.com/login?redirect=${redirectUrl}`;
        }
        }, 1500);
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
    // Ensure auth state persists if the network temporarily drops
    if (isOffline && initialAuthChecked) {
      // Keep the component mounted and effectively bypass redirection
      // which allows the application child components to remain functional using cached state
    }
  }, [isOffline, initialAuthChecked]);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let token = params.get('token');
    if (token) sessionStorage.setItem('axim_sso_token_backup', token);
    else token = sessionStorage.getItem('axim_sso_token_backup');

    const initializeAuth = () => {
      setIsRefreshingToken(true);

      // Immediately allow render if offline and previously authenticated
      if (isOffline && sessionStorage.getItem('axim_offline_session_active')) {
          setInitialAuthChecked(true);
          return;
      }

      if (token) {
        // Hydrate the local React/Supabase session seamlessly and asynchronously
        supabase.auth.setSession({
          access_token: token,
          refresh_token: token,
        }).then(async ({ error }) => {
           if (error) {
              console.error("Session hydration failed:", error);
           } else {
              const { data: sessionData } = await supabase.auth.getSession();
              const email = sessionData?.session?.user?.email;
              const whitelist = ["jrellars@gmail.com", "authorized@axim.us.com"];
              if (email && !whitelist.includes(email)) {
                await supabase.auth.signOut();
                alert("Unauthorized email address. Only internal treasury managers are allowed.");
                window.location.href = `https://passport.axim.us.com/login?redirect=${encodeURIComponent(window.location.origin + '/auth/callback')}`;
                return;
              }
              sessionStorage.setItem('axim_offline_session_active', 'true');
           }
           setInitialAuthChecked(true);
        });

        // Strip token from history to prevent token leakage
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        sessionStorage.removeItem('axim_sso_token_backup');
      } else {
        // Optimistic check first
        supabase.auth.getSession().then(({ data: { session }, error }) => {
            if (error) {
                // Network drop during background sync shouldn't clear state
                console.warn("Background sync failed:", error);
            }
            if (session) {
               setInitialAuthChecked(true);
               sessionStorage.setItem('axim_offline_session_active', 'true');
               try {
                 localStorage.setItem('axim_offline_session', JSON.stringify({ active: true, timestamp: Date.now() }));
               } catch(e) { /* ignore */ }
            } else {
               let cachedOffline = false;
               try {
                   const stored = localStorage.getItem('axim_offline_session');
                   if (stored) {
                       const parsed = JSON.parse(stored);
                       if (Date.now() - parsed.timestamp < 300000) cachedOffline = true;
                   }
               } catch(e) { /* ignore */ }

               if (isOffline || cachedOffline) {
                 setInitialAuthChecked(true);
               } else {
                 const redirectUrl = encodeURIComponent(window.location.origin + '/auth/callback');
                 window.location.href = `https://passport.axim.us.com/login?redirect=${redirectUrl}`;
               }
            }
        });
      }
      setIsRefreshingToken(false);
    };

    initializeAuth();
  }, []);

  if (initialAuthChecked) {
    return null; // The App component also conditionally renders AXiMLoginGate, returning null completely hides it when done.
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
