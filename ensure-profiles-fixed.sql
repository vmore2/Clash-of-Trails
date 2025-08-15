-- Ensure Profiles are Created Automatically (Fixed Version)
-- Run this in your Supabase SQL Editor

-- 1. Create a function to automatically create profiles when users sign up
CREATE OR REPLACE FUNCTION create_profile_on_signup()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, color)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'display_name', 'Player'),
        '#6aa2ff'
    )
    ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        color = COALESCE(profiles.color, EXCLUDED.color);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Drop existing trigger if it exists
DROP TRIGGER IF EXISTS create_profile_on_signup_trigger ON auth.users;

-- 3. Create the trigger
CREATE TRIGGER create_profile_on_signup_trigger
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_profile_on_signup();

-- 4. Create profiles for any existing users who don't have them
INSERT INTO public.profiles (id, display_name, color)
SELECT 
    u.id,
    'Player' as display_name,
    '#6aa2ff' as color
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 5. Ensure the profiles table has proper RLS policies
DROP POLICY IF EXISTS "profiles_select_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON profiles;

-- Allow users to see their own profile
CREATE POLICY "profiles_select_policy" ON profiles
    FOR SELECT USING (auth.uid() = id);

-- Allow users to insert their own profile
CREATE POLICY "profiles_insert_policy" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Allow users to update their own profile
CREATE POLICY "profiles_update_policy" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; 