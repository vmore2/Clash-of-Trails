-- Fix sessions table schema
-- Run this in your Supabase SQL editor

-- Check if sessions table exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sessions') THEN
        -- Create sessions table if it doesn't exist
        CREATE TABLE sessions (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
            group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
            start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            end_time TIMESTAMP WITH TIME ZONE,
            duration INTEGER, -- in milliseconds
            distance REAL, -- in meters
            avg_speed REAL, -- in m/s
            calories INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        -- Add RLS
        ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
        
        -- RLS policies
        CREATE POLICY "Users can view their own sessions" ON sessions
            FOR SELECT USING (auth.uid() = user_id);
            
        CREATE POLICY "Users can insert their own sessions" ON sessions
            FOR INSERT WITH CHECK (auth.uid() = user_id);
            
        CREATE POLICY "Users can update their own sessions" ON sessions
            FOR UPDATE USING (auth.uid() = user_id);
            
        RAISE NOTICE 'Created sessions table';
    ELSE
        -- Add missing columns if table exists
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'calories') THEN
            ALTER TABLE sessions ADD COLUMN calories INTEGER DEFAULT 0;
            RAISE NOTICE 'Added calories column';
        END IF;
        
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'avg_speed') THEN
            ALTER TABLE sessions ADD COLUMN avg_speed REAL;
            RAISE NOTICE 'Added avg_speed column';
        END IF;
        
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'distance') THEN
            ALTER TABLE sessions ADD COLUMN distance REAL;
            RAISE NOTICE 'Added distance column';
        END IF;
        
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'duration') THEN
            ALTER TABLE sessions ADD COLUMN duration INTEGER;
            RAISE NOTICE 'Added duration column';
        END IF;
        
        RAISE NOTICE 'Sessions table already exists, checked for missing columns';
    END IF;
END $$;
