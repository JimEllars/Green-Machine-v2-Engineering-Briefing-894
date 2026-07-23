# Green Machine v2 (AXiM Ecosystem)

Green Machine is the business-development and financial operations command layer for the AXiM ecosystem:
1. **React dashboard** (Vite) for market telemetry, ledger status, and operator controls.
2. **Cloudflare Worker** (`edge-ledger-worker`) for edge APIs, DLQ control, and market cache sync.
3. **Supabase** for realtime ledger data and financial recommendation storage.

## Local install

```bash
npm install
cp .env.example .env
```

Set values in `.env`:
1. `VITE_SUPABASE_URL`
2. `VITE_SUPABASE_ANON_KEY`
3. `VITE_WORKER_URL`
4. `VITE_AXIM_INTERNAL_KEY`

Run locally:

```bash
npm run dev
```

## Cloudflare setup (Worker + Pages)

### 1) Authenticate and check Wrangler

```bash
npx wrangler --version
npx wrangler login
npm run cf:whoami
```

### 2) Create KV namespaces for Worker bindings

```bash
npx wrangler kv namespace create GREEN_STATE
npx wrangler kv namespace create MARKET_CACHE
```

Copy the returned namespace IDs into:
`edge-ledger-worker/wrangler.jsonc`

### 3) Configure Worker secrets

Use `.dev.vars.example` as your key list for local dev values, then set production secrets in Cloudflare:

```bash
npx wrangler secret put AXIM_INTERNAL_KEY --config edge-ledger-worker/wrangler.jsonc
npx wrangler secret put ORACLE_API_KEY --config edge-ledger-worker/wrangler.jsonc
npx wrangler secret put SUPABASE_SERVICE_KEY --config edge-ledger-worker/wrangler.jsonc
```

Also set `SUPABASE_URL` in `wrangler.jsonc` under `vars`.

### 4) Deploy Worker

```bash
npm run cf:worker:deploy
```

After deploy, copy the Worker URL:
`https://green-machine-edge-ledger.<your-subdomain>.workers.dev`

### 5) Build and deploy frontend to Cloudflare Pages

Create/update local `.env` for production build:
1. `VITE_WORKER_URL` = Worker URL from step 4
2. `VITE_AXIM_INTERNAL_KEY` = same internal signature secret
3. Supabase values

Then deploy:

```bash
npm run build
npx wrangler pages project create green-machine-v2
npm run cf:pages:deploy -- --project-name green-machine-v2 --branch main
```

## Runtime notes

1. Worker cron is configured in `edge-ledger-worker/wrangler.jsonc` (`*/1 * * * *`) and calls market cache sync.
2. Dashboard endpoints expect `X-Axim-Signature` to match `AXIM_INTERNAL_KEY`.
3. Pages and Worker are deployed separately; frontend reaches Worker through `VITE_WORKER_URL`.
