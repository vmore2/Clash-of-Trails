-- Drop the existing table if it exists (this will delete all data)
DROP TABLE IF EXISTS captured_cells CASCADE;

-- Create the table with the correct structure
CREATE TABLE captured_cells (
  h3_id TEXT NOT NULL,
  group_id UUID NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY (h3_id, group_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE captured_cells ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view captured cells in their groups" ON captured_cells
  FOR SELECT USING (
    group_id IN (
      SELECT group_id FROM group_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert captured cells in their groups" ON captured_cells
  FOR INSERT WITH CHECK (
    group_id IN (
      SELECT group_id FROM group_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update captured cells in their groups" ON captured_cells
  FOR UPDATE USING (
    group_id IN (
      SELECT group_id FROM group_members WHERE user_id = auth.uid()
    )
  );

-- Verify the table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'captured_cells' 
AND table_schema = 'public'
ORDER BY ordinal_position; 