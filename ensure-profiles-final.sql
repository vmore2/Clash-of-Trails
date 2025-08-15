-- Ensure Profiles are Created Automatically (Final Version - Handles Unique Display Names)
-- Run this in your Supabase SQL Editor

-- 1. Create a function to automatically create profiles when users sign up
CREATE OR REPLACE FUNCTION create_profile_on_signup()
RETURNS TRIGGER AS $$
DECLARE
    base_name text;
    final_name text;
    counter int := 1;
BEGIN
    -- Get base display name from metadata or default
    base_name := COALESCE(NEW.raw_user_meta_data->>'display_name', 'Player');
    final_name := base_name;
    
    -- Make display name unique by adding numbers if needed
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE display_name = final_name) LOOP
        final_name := base_name || ' ' || counter;
        counter := counter + 1;
    END LOOP;
    
    INSERT INTO public.profiles (id, display_name, color)
    VALUES (
        NEW.id,
        final_name,
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
-- We'll do this one by one to handle unique constraints properly
DO $$
DECLARE
    user_record RECORD;
    base_name text := 'Player';
    final_name text;
    counter int;
BEGIN
    -- Loop through users without profiles
    FOR user_record IN 
        SELECT u.id, u.email
        FROM auth.users u
        LEFT JOIN public.profiles p ON p.id = u.id
        WHERE p.id IS NULL
    LOOP
        -- Generate unique display name
        final_name := base_name;
        counter := 1;
        
        WHILE EXISTS (SELECT 1 FROM public.profiles WHERE display_name = final_name) LOOP
            final_name := base_name || ' ' || counter;
            counter := counter + 1;
        END LOOP;
        
        -- Insert the profile
        INSERT INTO public.profiles (id, display_name, color)
        VALUES (user_record.id, final_name, '#6aa2ff')
        ON CONFLICT (id) DO NOTHING;
    END LOOP;
END $$;

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