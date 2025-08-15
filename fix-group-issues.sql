-- Fix Group Issues - Ambiguous columns and join_code
-- Run these commands in your Supabase SQL Editor

-- 1. Fix the ambiguous column reference in get_group_members function
DROP FUNCTION IF EXISTS get_group_members(uuid);

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
        SELECT 1 FROM group_members gm
        WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid()
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_group_members(uuid) TO authenticated;

-- 2. Make join_code optional (allow NULL values)
ALTER TABLE groups ALTER COLUMN join_code DROP NOT NULL;

-- 3. Create a trigger to auto-generate join_code when not provided
CREATE OR REPLACE FUNCTION generate_join_code_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- If join_code is not provided, generate one
    IF NEW.join_code IS NULL THEN
        NEW.join_code := encode(gen_random_bytes(4), 'hex');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS groups_generate_join_code ON groups;

-- Create the trigger
CREATE TRIGGER groups_generate_join_code
    BEFORE INSERT ON groups
    FOR EACH ROW
    EXECUTE FUNCTION generate_join_code_trigger();

-- 4. Test the fixes
-- This should work now:
-- SELECT * FROM get_group_members('your-group-id-here'); 