
CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  description text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  price_usd numeric(10,2),
  status text NOT NULL DEFAULT 'completed',
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions" ON public.credit_transactions
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions" ON public.credit_transactions
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_credit_transactions_user ON public.credit_transactions(user_id, created_at DESC);
