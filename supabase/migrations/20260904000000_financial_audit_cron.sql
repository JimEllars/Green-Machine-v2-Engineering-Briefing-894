-- Migration: 20260904000000_financial_audit_cron.sql
-- Description: Registers the database-native pg_cron schedule for the weekly cognitive sweep.

-- Ensure pg_cron and pg_net extensions are active
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the weekly-financial-audit to run every Sunday at 02:00 AM UTC
SELECT cron.schedule(
    'weekly-financial-audit',
    '0 2 * * 0', 
    $$
    SELECT net.http_post(
        url := 'https://[YOUR_PROJECT_REF].supabase.co/functions/v1/financial-audit',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
        ),
        body := jsonb_build_object(
            'trigger_source', 'pg_cron_weekly_sweep',
            'timestamp', NOW()
        )
    );
    $$
);