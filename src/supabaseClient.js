import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder_anon_key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Provide a custom flow to handle token refresh failures gracefully
    // to avoid sudden redirects or clearing local state on temporary network faults.
    storageKey: 'axim-green-machine-auth',
  }
});

// We can monkey-patch the auth error handling or rely on the UI components catching auth errors.
// By default, supabase-js v2 clears session on refresh failure.
// The best we can do natively without overriding the whole storage interface is simply
// listen to auth state changes and prevent hard redirects.

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED') {
    console.log('Session token refreshed successfully');
  } else if (event === 'SIGNED_OUT') {
    // We intentionally do not forcefully clear all application state or redirect here,
    // to preserve fault tolerance and "Stale-While-Revalidate" UI workflows.
    console.log('Auth session ended. Gracefully degrading to unauthenticated mode if applicable.');
  }
});
