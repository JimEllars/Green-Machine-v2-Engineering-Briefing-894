# Deployment Checklist

This document outlines the step-by-step procedure to follow when going live.

## 1. Verify AnnyTrade API Keys
- Check that the AnnyTrade API keys are correctly configured and have the necessary permissions.
- Ensure the keys are securely stored in the production environment variables (e.g., Cloudflare Secrets).

## 2. Make Initial Live Capital Deposit
- Perform the initial live capital deposit to the trading account.
- Confirm the deposit is reflected correctly in the system and the initial balance matches expectations.

## 3. Verify SUPABASE_JWT_SECRET
- Access the production Cloudflare Workers environment configuration.
- Verify that the `SUPABASE_JWT_SECRET` matches the one provided by your Supabase project. This ensures authentication tokens are correctly signed and validated.

## 4. Monitor First AI-Executed Trade
- Monitor the system logs and database entries for the first trade executed by the AI strategy.
- Verify the trade details (symbol, quantity, price, action) match the AI's intended strategy and that no errors occurred during execution.

## 5. Verify Telemetry and UI Updates
- Monitor the System Diagnostics Panel to ensure real-time telemetry metrics are streaming successfully from the Cloudflare Edge Worker.
- Inspect the StrategyConsultantTerminal and AffiliatePayoutGrid to verify the modern enterprise glassmorphic UI updates apply correctly across viewports.
- Confirm that the AXiMLoginGate and background cron tasks remain functional.
