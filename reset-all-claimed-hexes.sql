-- Reset all claimed hexagons in the database
-- WARNING: This will delete ALL territory claims for ALL users
-- Run this in your Supabase SQL editor

-- Option 1: Delete all claimed hexagons (COMPLETE RESET)
DELETE FROM captured_cells;

-- Option 2: Reset only for a specific group (if you want to keep other groups)
-- DELETE FROM captured_cells WHERE group_id = 'YOUR_GROUP_ID_HERE';

-- Option 3: Reset only for a specific user (if you want to keep other users)
-- DELETE FROM captured_cells WHERE user_id = 'YOUR_USER_ID_HERE';

-- Option 4: Reset only hexagons claimed in the last X days
-- DELETE FROM captured_cells WHERE claimed_at > NOW() - INTERVAL '7 days';

-- Verify the reset
SELECT 
    'Total claimed hexagons after reset:' as status,
    COUNT(*) as count
FROM captured_cells;

-- Show remaining data (should be 0 if using Option 1)
SELECT 
    group_id,
    user_id,
    h3_id,
    claimed_at
FROM captured_cells
LIMIT 10;
