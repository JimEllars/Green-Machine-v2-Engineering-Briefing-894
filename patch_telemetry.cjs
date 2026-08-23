const fs = require('fs');
const file = 'src/components/planner/SystemDiagnosticsPanel.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/const fetchDeepTelemetry = async \(\) => \{\};/, `
  const fetchDeepTelemetry = async () => {};
`);

content = content.replace(/await fetchDeepTelemetry\(\);/, `// await fetchDeepTelemetry();`);

fs.writeFileSync(file, content);
