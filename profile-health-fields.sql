-- Add health-related fields to profiles table
-- This migration is safe and won't break existing functionality

-- Add new health fields to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS height_cm DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS weight_kg DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS age INTEGER,
ADD COLUMN IF NOT EXISTS activity_level VARCHAR(20) DEFAULT 'moderate';

-- Add comments for documentation
COMMENT ON COLUMN profiles.height_cm IS 'Height in centimeters';
COMMENT ON COLUMN profiles.weight_kg IS 'Weight in kilograms';
COMMENT ON COLUMN profiles.age IS 'Age in years';
COMMENT ON COLUMN profiles.activity_level IS 'Activity level: sedentary, light, moderate, active';

-- Create index for better query performance on health-related queries
CREATE INDEX IF NOT EXISTS idx_profiles_health_data ON profiles(height_cm, weight_kg, age, activity_level);

-- Update existing profiles with default values (optional, for better UX)
UPDATE profiles 
SET 
  height_cm = 170.0,
  weight_kg = 70.0,
  age = 25,
  activity_level = 'moderate'
WHERE height_cm IS NULL 
  AND weight_kg IS NULL 
  AND age IS NULL 
  AND activity_level = 'moderate';

-- Verify the changes
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default
FROM information_schema.columns 
WHERE table_name = 'profiles' 
  AND column_name IN ('height_cm', 'weight_kg', 'age', 'activity_level')
ORDER BY column_name;

-- Show sample of updated profiles
SELECT 
  id, 
  display_name, 
  height_cm, 
  weight_kg, 
  age, 
  activity_level
FROM profiles 
LIMIT 5;
