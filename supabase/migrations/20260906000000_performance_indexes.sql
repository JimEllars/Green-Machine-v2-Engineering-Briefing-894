-- Migration: 20260906000000_performance_indexes.sql
-- Description: Adds composite indexing for high-throughput ledger queries and API usage logs.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blockchain_tx_partner_created
ON public.blockchain_transactions (partner_id, created_at DESC);

-- If api_usage_logs table exists, index the log timestamp:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_usage_logs_created
ON public.api_usage_logs (created_at DESC);

-- Ensure RLS policies explicitly allow authenticated users to read their own ledger entries.
ALTER TABLE public.blockchain_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'blockchain_transactions'
        AND policyname = 'Users can read own ledger entries'
    ) THEN
        CREATE POLICY "Users can read own ledger entries"
        ON public.blockchain_transactions
        FOR SELECT
        TO authenticated
        USING (partner_id = (SELECT auth.uid()::text));
    END IF;
END $$;
