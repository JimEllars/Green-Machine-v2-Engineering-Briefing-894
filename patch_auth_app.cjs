const fs = require('fs');

const path = 'src/components/auth/AXiMLoginGate.jsx';
let code = fs.readFileSync(path, 'utf8');

// Ensure that returning null properly unmounts or hides when auth is resolved.
const returnBypassOld = `  if ((isOffline || initialAuthChecked) && initialAuthChecked) {
    return null; // Return nothing so the main app can handle the render when offline or successfully verified from cache.
  }`;

const returnBypassNew = `  if (initialAuthChecked) {
    return null; // The App component also conditionally renders AXiMLoginGate, returning null completely hides it when done.
  }`;

code = code.replace(returnBypassOld, returnBypassNew);

fs.writeFileSync(path, code);
console.log("Auth fixed for App");
