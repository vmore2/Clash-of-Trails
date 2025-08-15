-- Fix RLS Policies for Groups and Group Members
-- Run these commands in your Supabase SQL Editor

-- 1. Drop existing policies (if they exist)
DROP POLICY IF EXISTS "groups_select_policy" ON groups;
DROP POLICY IF EXISTS "groups_insert_policy" ON groups;
DROP POLICY IF EXISTS "groups_update_policy" ON groups;
DROP POLICY IF EXISTS "groups_delete_policy" ON groups;

DROP POLICY IF EXISTS "group_members_select_policy" ON group_members;
DROP POLICY IF EXISTS "group_members_insert_policy" ON group_members;
DROP POLICY IF EXISTS "group_members_update_policy" ON group_members;
DROP POLICY IF EXISTS "group_members_delete_policy" ON group_members;

-- 2. Create new, more permissive policies for groups table

-- Allow users to see ALL groups (needed for joining)
CREATE POLICY "groups_select_policy" ON groups
    FOR SELECT USING (true);

-- Allow authenticated users to create groups
CREATE POLICY "groups_insert_policy" ON groups
    FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Allow group creators to update their groups
CREATE POLICY "groups_update_policy" ON groups
    FOR UPDATE USING (auth.uid() = created_by);

-- Allow group creators to delete their groups
CREATE POLICY "groups_delete_policy" ON groups
    FOR DELETE USING (auth.uid() = created_by);

-- 3. Create policies for group_members table

-- Allow users to see memberships for groups they belong to
CREATE POLICY "group_members_select_policy" ON group_members
    FOR SELECT USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_members.group_id 
            AND gm.user_id = auth.uid()
        )
    );

-- Allow users to join groups (insert their own membership)
CREATE POLICY "group_members_insert_policy" ON group_members
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own membership
CREATE POLICY "group_members_update_policy" ON group_members
    FOR UPDATE USING (auth.uid() = user_id);

-- Allow users to leave groups (delete their own membership)
CREATE POLICY "group_members_delete_policy" ON group_members
    FOR DELETE USING (auth.uid() = user_id);

-- 4. Ensure RLS is enabled
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- 5. Add missing join_code column if it doesn't exist (from your schema description)
ALTER TABLE groups ADD COLUMN IF NOT EXISTS join_code text UNIQUE;

-- 6. Create a function to generate join codes (optional, for future use)
CREATE OR REPLACE FUNCTION generate_join_code()
RETURNS text AS $$
BEGIN
    RETURN encode(gen_random_bytes(4), 'hex');
END;
$$ LANGUAGE plpgsql;

-- 7. Test query to verify policies work
-- This should show all groups if you run it as an authenticated user
-- SELECT id, name, created_by FROM groups; 