const fs = require('fs');
let content = fs.readFileSync('src/App.jsx', 'utf8');
content = content.replace(
  'setDlqStatus({ active: data.active || data.buffered_count > 0, count: data.count || data.buffered_count || 0, quarantine_count: data.quarantine_count || data.quarantined_count || 0, emailit_telemetry: data.emailit_telemetry, exec_governance: data.exec_governance, emailit_configured: data.emailit_configured });',
  'setDlqStatus({ active: data.active || data.buffered_count > 0, count: data.count || data.buffered_count || 0, quarantine_count: data.quarantine_count || data.quarantined_count || 0, emailit_telemetry: data.emailit_telemetry, exec_governance: data.exec_governance, emailit_configured: data.emailit_configured, autoheal_telemetry: data.autoheal_telemetry, investing_brain_telemetry: data.investing_brain_telemetry, anny_oracle: data.anny_oracle, webhook_ingress_telemetry: data.webhook_ingress_telemetry, dlq_autoheal_telemetry: data.dlq_autoheal_telemetry });'
);
fs.writeFileSync('src/App.jsx', content);
