-- Create function to get group members (bypasses RLS)
-- Run this in your Supabase SQL Editor

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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_group_members(uuid) TO authenticated; 