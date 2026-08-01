const { execSync, spawn } = require('child_process');

try {
  const child = spawn('npx', ['wrangler', 'dev', '--config', 'wrangler.jsonc', '--port', '8787'], {
    env: { ...process.env, CLOUDFLARE_API_TOKEN: 'fake_token' },
    cwd: './edge-ledger-worker'
  });

  child.stdout.on('data', (data) => console.log(data.toString()));
  child.stderr.on('data', (data) => console.error(data.toString()));
} catch (e) {
  console.log("Failed", e);
}
