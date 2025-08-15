-- Simple Supabase diagnostic
-- Run this in Supabase SQL Editor

-- Check if auth schema exists
SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'auth';

-- Check auth tables
SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth';

-- Check for triggers on auth.users (these might be causing the issue)
SELECT trigger_name, event_manipulation 
FROM information_schema.triggers 
WHERE event_object_schema = 'auth' AND event_object_table = 'users';

-- Simple test - try to see auth users table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'auth' AND table_name = 'users' 
LIMIT 5;