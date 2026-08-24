-- Task 1: Enforce Strict Postgres RLS
-- Enable RLS on the tables
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE blockchain_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_api_usage_logs ON api_usage_logs AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY deny_anon_blockchain_transactions ON blockchain_transactions AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);

-- Explicitly allow service_role
CREATE POLICY allow_service_role_api_usage_logs ON api_usage_logs AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY allow_service_role_blockchain_transactions ON blockchain_transactions AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
