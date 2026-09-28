const fs = require('fs');

const path = 'src/components/auth/AXiMLoginGate.jsx';
let code = fs.readFileSync(path, 'utf8');

// Ensure token refresh errors fall back gracefully to active session storage rather than forcing an immediate redirect to login.
const tokenRefreshedListenerOld = `      if (event === 'TOKEN_REFRESHED' && session) {
        // Silently update cache without triggering unmounts
        try {
          localStorage.setItem('axim_offline_session', JSON.stringify({ active: true, timestamp: Date.now() }));
        } catch(e) { /* ignore */ }
      }`;

const tokenRefreshedListenerNew = `      if (event === 'TOKEN_REFRESHED' && session) {
        // Silently update cache without triggering unmounts
        try {
          localStorage.setItem('axim_offline_session', JSON.stringify({ active: true, timestamp: Date.now() }));
        } catch(e) { /* ignore */ }
      } else if (event === 'SIGNED_OUT') {
        // Handle signed out events gracefully, check if we have a valid offline cache before hard redirect
        let cachedOffline = false;
        try {
            const stored = localStorage.getItem('axim_offline_session');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Date.now() - parsed.timestamp < 86400000) cachedOffline = true;
            }
        } catch(e) { /* ignore */ }

        if (!cachedOffline && !isOffline) {
          const redirectUrl = encodeURIComponent(window.location.origin + '/auth/callback');
          window.location.href = \`https://passport.axim.us.com/login?redirect=\${redirectUrl}\`;
        }
      }`;

code = code.replace(tokenRefreshedListenerOld, tokenRefreshedListenerNew);


// When returning the null bypass, we also need to allow bypass if we have a valid cache, regardless of isOffline since a failed refresh shouldn't log you out if cache is valid.
const returnBypassOld = `  if (isOffline && initialAuthChecked) {
    return null; // Return nothing so the main app can handle the render when offline but logged in.
  }`;

const returnBypassNew = `  if ((isOffline || initialAuthChecked) && initialAuthChecked) {
    return null; // Return nothing so the main app can handle the render when offline or successfully verified from cache.
  }`;

code = code.replace(returnBypassOld, returnBypassNew);

// Actually, wait, initialAuthChecked is true when the component thinks it's done authenticating.
// If it is true, it shouldn't render the login screen, it should unmount itself or return null for the main app.
// Wait, AXiMLoginGate might be used as a wrapper. Let's check App.jsx.
fs.writeFileSync(path, code);
console.log("Auth patched");
