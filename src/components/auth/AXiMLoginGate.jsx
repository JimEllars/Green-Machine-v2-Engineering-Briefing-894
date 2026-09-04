import React, { useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import SafeIcon from '../../common/SafeIcon';

const AXiMLoginGate = () => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    const initializeAuth = async () => {
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
      } else {
        // Automatically route the user to SSO
        const redirectUrl = encodeURIComponent(window.location.origin + '/auth/callback');
        window.location.href = `https://passport.axim.us.com/login?redirect=${redirectUrl}`;
      }
    };

    initializeAuth();
  }, []);

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
              Authenticating...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AXiMLoginGate;
