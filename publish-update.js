#!/usr/bin/env node

/**
 * Simple script to publish OTA updates for Clash of Trails
 * Run this after making code changes to push updates to your friends
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Publishing OTA Update for Clash of Trails...\n');

try {
  // Change to the project directory
  process.chdir(path.join(__dirname));
  
  console.log('📱 Publishing update to Expo...');
  
  // Publish the update
  execSync('npx expo publish', { 
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' }
  });
  
  console.log('\n✅ Update published successfully!');
  console.log('📱 Your friends will see the update notification in their app');
  console.log('🔄 They can tap "Update Now" to get the latest version');
  
} catch (error) {
  console.error('\n❌ Failed to publish update:', error.message);
  console.log('\n💡 Make sure you have:');
  console.log('   - Made your code changes');
  console.log('   - Saved all files');
  console.log('   - Have internet connection');
  console.log('   - Are logged into Expo (run: npx expo login)');
  
  process.exit(1);
}
