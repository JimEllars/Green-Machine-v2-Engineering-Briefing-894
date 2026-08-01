const { execSync } = require('child_process');

try {
  execSync('npm run cf:worker:dev', { env: { ...process.env, CLOUDFLARE_API_TOKEN: 'fake_token' }, stdio: 'inherit' });
} catch (e) {
  console.log("Failed", e);
}
