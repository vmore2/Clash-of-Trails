-- Check what columns actually exist in captured_cells table
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'captured_cells' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check if the table exists at all
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'captured_cells'
); 