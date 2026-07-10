-- Migration: 20270401000000_blockchain_ledger.sql
-- Description: Establishes the Web3 ledger for tracking Thirdweb smart contract settlements.

CREATE TYPE transaction_status AS ENUM ('pending', 'minted', 'failed');

CREATE TABLE IF NOT EXISTS public.blockchain_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL,
    wallet_address TEXT NOT NULL,
    smart_contract_address TEXT NOT NULL,
    amount NUMERIC(18, 8) NOT NULL,
    currency TEXT NOT NULL,
    status transaction_status DEFAULT 'pending',
    transaction_hash TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for high-velocity lookups by partner or status
CREATE INDEX idx_blockchain_tx_partner ON public.blockchain_transactions(partner_id);
CREATE INDEX idx_blockchain_tx_status ON public.blockchain_transactions(status);

-- Trigger to enforce strict timestamp modification tracking natively inside Postgres
CREATE OR REPLACE FUNCTION update_blockchain_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_blockchain_transactions_updated_at
BEFORE UPDATE ON public.blockchain_transactions
FOR EACH ROW
EXECUTE FUNCTION update_blockchain_transactions_updated_at();

-- RLS Policies (Locked down for edge-ingress only by default)
ALTER TABLE public.blockchain_transactions ENABLE ROW LEVEL SECURITY;