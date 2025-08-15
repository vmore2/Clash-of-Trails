-- Fix groups and profiles database schema
-- Run this in your Supabase SQL editor

-- 1. Ensure profiles table has correct structure
DO $$ 
BEGIN
    -- Add group_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'profiles' AND column_name = 'group_id'
    ) THEN
        ALTER TABLE profiles ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added group_id column to profiles table';
    ELSE
        RAISE NOTICE 'group_id column already exists in profiles table';
    END IF;
    
    -- Add display_name column if it doesn't exist
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'profiles' AND column_name = 'display_name'
    ) THEN
        ALTER TABLE profiles ADD COLUMN display_name TEXT DEFAULT 'Player';
        RAISE NOTICE 'Added display_name column to profiles table';
    ELSE
        RAISE NOTICE 'display_name column already exists in profiles table';
    END IF;
    
    -- Add color column if it doesn't exist
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'profiles' AND column_name = 'color'
    ) THEN
        ALTER TABLE profiles ADD COLUMN color TEXT DEFAULT '#6aa2ff';
        RAISE NOTICE 'Added color column to profiles table';
    ELSE
        RAISE NOTICE 'color column already exists in profiles table';
    END IF;
END $$;

-- 2. Ensure groups table has correct structure
DO $$ 
BEGIN
    -- Add created_by column if it doesn't exist
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'groups' AND column_name = 'created_by'
    ) THEN
        ALTER TABLE groups ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added created_by column to groups table';
    ELSE
        RAISE NOTICE 'created_by column already exists in groups table';
    END IF;
    
    -- Add created_at column if it doesn't exist
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'groups' AND column_name = 'created_at'
    ) THEN
        ALTER TABLE groups ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added created_at column to groups table';
    ELSE
        RAISE NOTICE 'created_at column already exists in groups table';
    END IF;
END $$;

-- 3. Ensure group_members table has correct structure
DO $$ 
BEGIN
    -- Add joined_at column if it doesn't exist
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'group_members' AND column_name = 'joined_at'
    ) THEN
        ALTER TABLE group_members ADD COLUMN joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added joined_at column to group_members table';
    ELSE
        RAISE NOTICE 'joined_at column already exists in group_members table';
    END IF;
    
    -- Add role column if it doesn't exist
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'group_members' AND column_name = 'role'
    ) THEN
        ALTER TABLE group_members ADD COLUMN role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member', 'admin'));
        RAISE NOTICE 'Added role column to group_members table';
    ELSE
        RAISE NOTICE 'role column already exists in group_members table';
    END IF;
END $$;

-- 4. Update existing profiles with default values if needed
UPDATE profiles 
SET 
    display_name = COALESCE(display_name, 'Player' || id::text),
    color = COALESCE(color, '#' || substr(md5(id::text), 1, 6))
WHERE display_name IS NULL OR color IS NULL;

-- 5. Update existing group_members with default values if needed
UPDATE group_members 
SET 
    role = COALESCE(role, 'member'),
    joined_at = COALESCE(joined_at, NOW())
WHERE role IS NULL OR joined_at IS NULL;

-- 6. Ensure RLS policies are correct
-- Profiles RLS
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
CREATE POLICY "Users can view their own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
CREATE POLICY "Users can insert their own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Groups RLS
DROP POLICY IF EXISTS "Users can view groups they're members of" ON groups;
CREATE POLICY "Users can view groups they're members of" ON groups
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM group_members 
            WHERE group_id = id AND user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can create groups" ON groups;
CREATE POLICY "Users can create groups" ON groups
    FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Group members RLS
DROP POLICY IF EXISTS "Users can view members of their groups" ON group_members;
CREATE POLICY "Users can view members of their groups" ON group_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM group_members gm2 
            WHERE gm2.group_id = group_id AND gm2.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can join groups" ON group_members;
CREATE POLICY "Users can join groups" ON group_members
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 7. Verify the setup
SELECT 
    'Profiles count:' as info,
    COUNT(*) as count
FROM profiles;

SELECT 
    'Groups count:' as info,
    COUNT(*) as count
FROM groups;

SELECT 
    'Group members count:' as info,
    COUNT(*) as count
FROM group_members;

-- Show sample data
SELECT 
    'Sample profiles:' as info,
    id,
    display_name,
    color,
    group_id
FROM profiles
LIMIT 5;

SELECT 
    'Sample groups:' as info,
    id,
    name,
    created_by,
    created_at
FROM groups
LIMIT 5;

SELECT 
    'Sample group members:' as info,
    group_id,
    user_id,
    role,
    joined_at
FROM group_members
LIMIT 5;
