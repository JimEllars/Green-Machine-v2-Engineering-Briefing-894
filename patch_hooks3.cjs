const fs = require('fs');

const path = 'src/hooks/useSystemDiagnostics.js';
let code = fs.readFileSync(path, 'utf8');

// Fix pollInterval reference in new injection
code = code.replace(
  "  useEffect(() => {\n    fetchDiagnosticsNew();\n    const interval = setInterval(fetchDiagnosticsNew, 15000); // adaptive interval handling might be inside the new panel or just default 15s here\n    return () => clearInterval(interval);\n  }, [fetchDiagnosticsNew]);",
  "  useEffect(() => {\n    fetchDiagnosticsNew();\n    const interval = setInterval(fetchDiagnosticsNew, 15000);\n    return () => clearInterval(interval);\n  }, [fetchDiagnosticsNew]);"
);

// We need to fix the pollInterval bug from the earlier code patching where pollInterval wasn't passed down.
// In our manual `patch_hooks.cjs` we appended `pollInterval` inside `useSystemDiagnostics`, but then rewrote it in `patch_hooks2.cjs`.
// Let's just fix the hook signature:
code = code.replace(
  "export const useSystemDiagnostics = (isAuthenticated = true) => {",
  "export const useSystemDiagnostics = (isAuthenticated = true, pollInterval = 15000) => {"
);

// Fix the undefined 'error' variable at line 493
code = code.replace(
  "diagnosticsError: error,",
  "diagnosticsError: errorLocal,"
);

fs.writeFileSync(path, code);
console.log("Hook patched successfully");
