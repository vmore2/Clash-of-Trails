-- Check the current schema of captured_cells table
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'captured_cells' 
AND table_schema = 'public';

-- If captured_at column exists, remove it
ALTER TABLE captured_cells DROP COLUMN IF EXISTS captured_at;

-- Ensure the table has the correct structure
CREATE TABLE IF NOT EXISTS captured_cells (
  h3_id TEXT NOT NULL,
  group_id UUID NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY (h3_id, group_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Add RLS policy if it doesn't exist
ALTER TABLE captured_cells ENABLE ROW LEVEL SECURITY;

-- Create policy for captured_cells
DROP POLICY IF EXISTS "Users can view captured cells in their groups" ON captured_cells;
CREATE POLICY "Users can view captured cells in their groups" ON captured_cells
  FOR SELECT USING (
    group_id IN (
      SELECT group_id FROM group_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert captured cells in their groups" ON captured_cells;
CREATE POLICY "Users can insert captured cells in their groups" ON captured_cells
  FOR INSERT WITH CHECK (
    group_id IN (
      SELECT group_id FROM group_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update captured cells in their groups" ON captured_cells;
CREATE POLICY "Users can update captured cells in their groups" ON captured_cells
  FOR UPDATE USING (
    group_id IN (
      SELECT group_id FROM group_members WHERE user_id = auth.uid()
    )
  ); 