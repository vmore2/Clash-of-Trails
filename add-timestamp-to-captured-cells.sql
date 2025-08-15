-- Add timestamp to captured_cells table for conflict resolution
-- This script adds a claimed_at column to track when each hexagon was claimed

-- Add the claimed_at column if it doesn't exist
ALTER TABLE captured_cells 
ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing records to have a claimed_at timestamp
UPDATE captured_cells 
SET claimed_at = NOW() 
WHERE claimed_at IS NULL;

-- Make the column NOT NULL after updating existing records
ALTER TABLE captured_cells 
ALTER COLUMN claimed_at SET NOT NULL;

-- Add an index on claimed_at for better performance
CREATE INDEX IF NOT EXISTS idx_captured_cells_claimed_at 
ON captured_cells(claimed_at);

-- Add an index on the combination of h3_id and group_id for upsert operations
CREATE INDEX IF NOT EXISTS idx_captured_cells_h3_group 
ON captured_cells(h3_id, group_id);

-- Verify the changes
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default
FROM information_schema.columns 
WHERE table_name = 'captured_cells' 
ORDER BY ordinal_position;

-- Show sample data with timestamps
SELECT 
  h3_id, 
  group_id, 
  user_id, 
  claimed_at
FROM captured_cells 
LIMIT 5;
