CREATE OR REPLACE FUNCTION public.add_credits(amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  new_balance integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF amount IS NULL OR amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  INSERT INTO public.profiles (id, credits)
  VALUES (uid, amount)
  ON CONFLICT (id) DO UPDATE SET credits = public.profiles.credits + EXCLUDED.credits
  RETURNING credits INTO new_balance;
  RETURN new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_credits(integer) TO authenticated;