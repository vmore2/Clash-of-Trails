// Test Database Connection
// Run this in your browser console or Node.js to test the database connection

import { createClient } from '@supabase/supabase-js';

// Replace with your actual Supabase URL and anon key
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testDatabaseConnection() {
  console.log('🧪 Testing database connection...');
  
  try {
    // Test 1: Basic connection
    console.log('1. Testing basic connection...');
    const { data: testData, error: testError } = await supabase
      .from('groups')
      .select('count')
      .limit(1);
    
    if (testError) {
      console.log('❌ Basic connection failed:', testError);
      return;
    }
    console.log('✅ Basic connection successful');
    
    // Test 2: Check if tables exist
    console.log('2. Checking table structure...');
    const { data: tables, error: tablesError } = await supabase
      .rpc('get_table_columns', { table_name: 'groups' });
    
    if (tablesError) {
      console.log('⚠️ Could not check table structure:', tablesError);
    } else {
      console.log('✅ Table structure check successful');
    }
    
    // Test 3: Check RLS policies
    console.log('3. Checking RLS policies...');
    const { data: policies, error: policiesError } = await supabase
      .rpc('get_table_policies', { table_name: 'groups' });
    
    if (policiesError) {
      console.log('⚠️ Could not check RLS policies:', policiesError);
    } else {
      console.log('✅ RLS policies check successful');
    }
    
    console.log('🎉 Database connection test completed successfully!');
    
  } catch (error) {
    console.log('❌ Database test failed:', error);
  }
}

// Test without authentication
testDatabaseConnection();

// If you want to test with authentication, you can add this:
async function testWithAuth() {
  console.log('🔐 Testing with authentication...');
  
  try {
    // Sign in with test credentials (replace with actual test user)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: 'test@example.com',
      password: 'testpassword'
    });
    
    if (authError) {
      console.log('❌ Authentication failed:', authError);
      return;
    }
    
    console.log('✅ Authentication successful');
    
    // Test authenticated operations
    const { data: userGroups, error: groupsError } = await supabase
      .from('group_members')
      .select('group_id, groups(name)')
      .eq('user_id', authData.user.id);
    
    if (groupsError) {
      console.log('❌ Authenticated query failed:', groupsError);
    } else {
      console.log('✅ Authenticated query successful:', userGroups);
    }
    
  } catch (error) {
    console.log('❌ Auth test failed:', error);
  }
}

// Uncomment to test with authentication
// testWithAuth();
