-- Restore the simple working setup
-- Run this in Supabase SQL Editor

-- Just make sure profiles table exists with basic structure
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  display_name text,
  color text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Simple RLS policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users only" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Enable update for users based on id" ON public.profiles
  FOR UPDATE USING (auth.uid() = id); 