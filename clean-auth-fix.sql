-- Clean up any problematic triggers that might be blocking signup
-- Run this in Supabase SQL Editor

-- Remove any custom triggers on auth.users that might be failing
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS create_profile_on_signup ON auth.users;
DROP TRIGGER IF EXISTS handle_new_user_trigger ON auth.users;
DROP TRIGGER IF EXISTS user_signup_trigger ON auth.users;

-- Remove any custom functions that might be causing issues
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.create_profile_on_signup() CASCADE;
DROP FUNCTION IF EXISTS public.handle_user_signup() CASCADE;

-- Make sure profiles table exists with minimal setup
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  display_name text,
  color text,
  created_at timestamp with time zone DEFAULT now()
);

-- Disable RLS on profiles temporarily
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT ALL ON public.profiles TO authenticated;

-- Test if we can query auth schema (should not give errors)
SELECT COUNT(*) as user_count FROM auth.users; 