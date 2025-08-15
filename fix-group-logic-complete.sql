-- Complete Fix for Group Join and Create Logic
-- Run this in your Supabase SQL Editor

-- 1. First, let's check what tables exist and their current structure
SELECT table_name, column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name IN ('groups', 'group_members', 'profiles', 'captured_cells')
ORDER BY table_name, ordinal_position;

-- 2. Create or fix the groups table
CREATE TABLE IF NOT EXISTS groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create or fix the group_members table
CREATE TABLE IF NOT EXISTS group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

-- 4. Create or fix the profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6aa2ff',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create or fix the captured_cells table
CREATE TABLE IF NOT EXISTS captured_cells (
  h3_id TEXT NOT NULL,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (h3_id, group_id)
);

-- 6. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_captured_cells_group_id ON captured_cells(group_id);
CREATE INDEX IF NOT EXISTS idx_captured_cells_user_id ON captured_cells(user_id);

-- 7. Enable RLS on all tables
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE captured_cells ENABLE ROW LEVEL SECURITY;

-- 8. Drop existing policies to start fresh
DROP POLICY IF EXISTS "groups_select_policy" ON groups;
DROP POLICY IF EXISTS "groups_insert_policy" ON groups;
DROP POLICY IF EXISTS "groups_update_policy" ON groups;
DROP POLICY IF EXISTS "groups_delete_policy" ON groups;

DROP POLICY IF EXISTS "group_members_select_policy" ON group_members;
DROP POLICY IF EXISTS "group_members_insert_policy" ON group_members;
DROP POLICY IF EXISTS "group_members_update_policy" ON group_members;
DROP POLICY IF EXISTS "group_members_delete_policy" ON group_members;

DROP POLICY IF EXISTS "profiles_select_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON profiles;

DROP POLICY IF EXISTS "captured_cells_select_policy" ON captured_cells;
DROP POLICY IF EXISTS "captured_cells_insert_policy" ON captured_cells;
DROP POLICY IF EXISTS "captured_cells_update_policy" ON captured_cells;
DROP POLICY IF EXISTS "captured_cells_delete_policy" ON captured_cells;

-- 9. Create new, simple RLS policies

-- Groups policies
CREATE POLICY "groups_select_policy" ON groups FOR SELECT USING (true);
CREATE POLICY "groups_insert_policy" ON groups FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "groups_update_policy" ON groups FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "groups_delete_policy" ON groups FOR DELETE USING (auth.uid() = created_by);

-- Group members policies
CREATE POLICY "group_members_select_policy" ON group_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "group_members_insert_policy" ON group_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "group_members_update_policy" ON group_members FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "group_members_delete_policy" ON group_members FOR DELETE USING (auth.uid() = user_id);

-- Profiles policies
CREATE POLICY "profiles_select_policy" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_policy" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_policy" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Captured cells policies
CREATE POLICY "captured_cells_select_policy" ON captured_cells FOR SELECT USING (
  group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
);
CREATE POLICY "captured_cells_insert_policy" ON captured_cells FOR INSERT WITH CHECK (
  group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
);
CREATE POLICY "captured_cells_update_policy" ON captured_cells FOR UPDATE USING (
  group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
);
CREATE POLICY "captured_cells_delete_policy" ON captured_cells FOR DELETE USING (
  group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
);

-- 10. Create the get_group_members function
CREATE OR REPLACE FUNCTION get_group_members(p_group_id uuid)
RETURNS TABLE (
    user_id uuid,
    role text,
    display_name text,
    color text,
    joined_at timestamptz
) 
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Check if the requesting user is a member of this group
    IF NOT EXISTS (
        SELECT 1 FROM group_members 
        WHERE group_id = p_group_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'You are not a member of this group';
    END IF;
    
    -- Return all members of the group with their profile info
    RETURN QUERY
    SELECT 
        gm.user_id,
        gm.role,
        p.display_name,
        p.color,
        gm.joined_at
    FROM group_members gm
    JOIN profiles p ON p.id = gm.user_id
    WHERE gm.group_id = p_group_id
    ORDER BY gm.joined_at ASC;
END;
$$;

-- 11. Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON groups TO authenticated;
GRANT ALL ON group_members TO authenticated;
GRANT ALL ON profiles TO authenticated;
GRANT ALL ON captured_cells TO authenticated;
GRANT EXECUTE ON FUNCTION get_group_members(uuid) TO authenticated;

-- 12. Create a function to ensure profile exists
CREATE OR REPLACE FUNCTION ensure_profile_ready(p_display_name text DEFAULT 'Player')
RETURNS void
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    base_name text;
    final_name text;
    counter int := 1;
BEGIN
    -- Check if profile already exists
    IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()) THEN
        RETURN;
    END IF;
    
    -- Generate unique display name
    base_name := p_display_name;
    final_name := base_name;
    
    WHILE EXISTS (SELECT 1 FROM profiles WHERE display_name = final_name) LOOP
        final_name := base_name || ' ' || counter;
        counter := counter + 1;
    END LOOP;
    
    -- Insert the profile
    INSERT INTO profiles (id, display_name, color)
    VALUES (
        auth.uid(),
        final_name,
        '#' || lpad(to_hex(floor(random() * 16777215)::int), 6, '0')
    );
END;
$$;

-- 13. Grant execute permission
GRANT EXECUTE ON FUNCTION ensure_profile_ready(text) TO authenticated;

-- 14. Test the setup
-- This will show you if everything is working
SELECT 'Setup complete! Testing tables...' as status;

-- Test groups table
SELECT COUNT(*) as groups_count FROM groups;

-- Test group_members table  
SELECT COUNT(*) as members_count FROM group_members;

-- Test profiles table
SELECT COUNT(*) as profiles_count FROM profiles;

-- Test captured_cells table
SELECT COUNT(*) as cells_count FROM captured_cells;

-- Test RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('groups', 'group_members', 'profiles', 'captured_cells');
