-- Fix RLS Policies - Version 2 (No Infinite Recursion)
-- Run these commands in your Supabase SQL Editor

-- 1. Drop existing policies to start fresh
DROP POLICY IF EXISTS "groups_select_policy" ON groups;
DROP POLICY IF EXISTS "groups_insert_policy" ON groups;
DROP POLICY IF EXISTS "groups_update_policy" ON groups;
DROP POLICY IF EXISTS "groups_delete_policy" ON groups;

DROP POLICY IF EXISTS "group_members_select_policy" ON group_members;
DROP POLICY IF EXISTS "group_members_insert_policy" ON group_members;
DROP POLICY IF EXISTS "group_members_update_policy" ON group_members;
DROP POLICY IF EXISTS "group_members_delete_policy" ON group_members;

-- 2. Create simple, non-recursive policies for groups table

-- Allow users to see ALL groups (needed for joining by name)
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

-- 3. Create simple, non-recursive policies for group_members table

-- Allow users to see their own memberships only
CREATE POLICY "group_members_select_policy" ON group_members
    FOR SELECT USING (auth.uid() = user_id);

-- Allow users to insert their own membership
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

-- 5. Test the policies
-- SELECT id, name FROM groups; -- Should show all groups
-- SELECT * FROM group_members WHERE user_id = auth.uid(); -- Should show your memberships 