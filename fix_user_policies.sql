-- 1. Create a function to check if the current user is an admin
-- We use SECURITY DEFINER to break the recursion. This function runs 
-- with the bypass-RLS privileges of the creator.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.users 
    -- Use ::text casting to compare UUID (auth.uid) with id (regardless if it's bigint or uuid)
    WHERE id::text = auth.uid()::text 
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Update the RLS policy on the users table
-- Drop the old policy first
DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;
DROP POLICY IF EXISTS "Users can view their own data" ON public.users;
DROP POLICY IF EXISTS "Allow individual read" ON public.users;
DROP POLICY IF EXISTS "Allow admin full access" ON public.users;

-- 3. Create clean, non-recursive policies
-- We use ::text casting here as well to fix the "uuid = bigint" error
CREATE POLICY "Allow individual read" ON public.users
FOR SELECT 
USING (auth.uid()::text = id::text);

CREATE POLICY "Allow admin full access" ON public.users
FOR ALL USING (public.is_admin());