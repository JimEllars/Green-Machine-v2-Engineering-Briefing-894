const fs = require('fs');

let content = fs.readFileSync('src/App.jsx', 'utf8');

content = content.replace(
  "const { refetch: refetchSystemDiagnostics } = useSystemDiagnostics();",
  "const { refetch: refetchSystemDiagnostics } = useSystemDiagnostics(authState === 'Authenticated');"
);

fs.writeFileSync('src/App.jsx', content, 'utf8');
console.log('App.jsx patched successfully');
