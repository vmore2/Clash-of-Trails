// lib/supabase.js
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://eogtmnkawjcgddsdlnld.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvZ3Rtbmthd2pjZ2Rkc2RsbmxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxOTU5NzgsImV4cCI6MjA3MDc3MTk3OH0.SXmHApF0_yHAqoam3pKPEU2AGWWkDeii5vftJ-6tE5k';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // RN apps don’t use URL callbacks
  },
});
