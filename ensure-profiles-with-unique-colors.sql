-- Ensure Profiles are Created Automatically (Handles Unique Display Names AND Colors)
-- Run this in your Supabase SQL Editor

-- 1. Create a function to generate random colors
CREATE OR REPLACE FUNCTION generate_random_color()
RETURNS text AS $$
DECLARE
    colors text[] := ARRAY[
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#F39C12', '#E74C3C', '#9B59B6', '#3498DB',
        '#2ECC71', '#F1C40F', '#E67E22', '#E91E63', '#9C27B0',
        '#673AB7', '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4',
        '#009688', '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B',
        '#FFC107', '#FF9800', '#FF5722', '#795548', '#607D8B'
    ];
    random_color text;
BEGIN
    -- Keep trying until we find a unique color
    LOOP
        random_color := colors[1 + floor(random() * array_length(colors, 1))::int];
        
        -- Check if this color is already used
        IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE color = random_color) THEN
            RETURN random_color;
        END IF;
        
        -- If all predefined colors are used, generate a random hex
        IF (SELECT COUNT(*) FROM public.profiles WHERE color = ANY(colors)) >= array_length(colors, 1) THEN
            random_color := '#' || lpad(to_hex(floor(random() * 16777215)::int), 6, '0');
            IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE color = random_color) THEN
                RETURN random_color;
            END IF;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 2. Create a function to automatically create profiles when users sign up
CREATE OR REPLACE FUNCTION create_profile_on_signup()
RETURNS TRIGGER AS $$
DECLARE
    base_name text;
    final_name text;
    counter int := 1;
    final_color text;
BEGIN
    -- Get base display name from metadata or default
    base_name := COALESCE(NEW.raw_user_meta_data->>'display_name', 'Player');
    final_name := base_name;
    
    -- Make display name unique by adding numbers if needed
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE display_name = final_name) LOOP
        final_name := base_name || ' ' || counter;
        counter := counter + 1;
    END LOOP;
    
    -- Generate unique color
    final_color := generate_random_color();
    
    INSERT INTO public.profiles (id, display_name, color)
    VALUES (
        NEW.id,
        final_name,
        final_color
    )
    ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        color = COALESCE(profiles.color, EXCLUDED.color);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Drop existing trigger if it exists
DROP TRIGGER IF EXISTS create_profile_on_signup_trigger ON auth.users;

-- 4. Create the trigger
CREATE TRIGGER create_profile_on_signup_trigger
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_profile_on_signup();

-- 5. Create profiles for any existing users who don't have them
-- We'll do this one by one to handle unique constraints properly
DO $$
DECLARE
    user_record RECORD;
    base_name text := 'Player';
    final_name text;
    final_color text;
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
        
        -- Generate unique color
        SELECT generate_random_color() INTO final_color;
        
        -- Insert the profile
        INSERT INTO public.profiles (id, display_name, color)
        VALUES (user_record.id, final_name, final_color)
        ON CONFLICT (id) DO NOTHING;
    END LOOP;
END $$;

-- 6. Ensure the profiles table has proper RLS policies
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