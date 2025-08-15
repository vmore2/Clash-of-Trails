-- Simple database fix for hexagon claiming
-- Run this in your Supabase SQL editor

-- 1. Add claimed_at column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'captured_cells' AND column_name = 'claimed_at'
    ) THEN
        ALTER TABLE captured_cells ADD COLUMN claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added claimed_at column';
    ELSE
        RAISE NOTICE 'claimed_at column already exists';
    END IF;
END $$;

-- 2. Update existing records to have timestamps
UPDATE captured_cells 
SET claimed_at = NOW() 
WHERE claimed_at IS NULL;

-- 3. Make sure the column is NOT NULL
ALTER TABLE captured_cells ALTER COLUMN claimed_at SET NOT NULL;

-- 4. Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_captured_cells_claimed_at ON captured_cells(claimed_at);
CREATE INDEX IF NOT EXISTS idx_captured_cells_h3_group ON captured_cells(h3_id, group_id);

-- 5. Show the current table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'captured_cells' 
ORDER BY ordinal_position;

-- 6. Show sample data
SELECT 
    h3_id, 
    group_id, 
    user_id, 
    claimed_at
FROM captured_cells 
LIMIT 5;
