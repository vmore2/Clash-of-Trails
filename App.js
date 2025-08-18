// App.js — Clash of Trails (Expo)
// Groups: direct DB create/join (no RPC). Hex grid always on. Live capture + bulk on stop.

import React, { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import {
  Alert,
  SafeAreaView,
  Text,
  TextInput,
  View,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Easing,
  Switch,
  AppState,
  PanResponder,
  Linking,
} from 'react-native';
import MapView, { Polygon, Marker } from 'react-native-maps';
import WebMapView from './WebMapView';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as h3 from 'h3-js';
import { supabase } from './lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import HealthProfileSetup from './HealthProfileSetup';
import * as Updates from 'expo-updates';
import { Pedometer } from 'expo-sensors';

/* ------------------ CONFIG ------------------ */
const H3_RES = 9; // Keep consistent resolution across platforms for proper hex rendering

// Performance optimizations for all platforms
const PERFORMANCE_CONFIG = {
  // Consistent animation duration
  animationDuration: 1.0,
  // Consistent shadow opacity
  shadowOpacity: 1.0,
  // Use hardware acceleration for all platforms
  useHardwareAcceleration: true,
  // Consistent render throttle
  renderThrottle: 8, // 120fps for all platforms
};

// Performance optimization hook for all platforms
const usePerformance = () => {
  useLayoutEffect(() => {
    // Enable performance optimizations for all platforms
    if (global.__expo) {
      // Expo-specific optimizations
      global.__expo.performanceMode = true;
    }
  }, []);
  
  return PERFORMANCE_CONFIG;
};

/* ------------------ HELPERS ------------------ */
const toRad = d => (d * Math.PI) / 180;
const haversine = (p1, p2) => {
  const R = 6371000;
  const dLat = toRad(p2.lat - p1.lat), dLon = toRad(p2.lon - p1.lon);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(p1.lat))*Math.cos(toRad(p2.lat))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
const totalDistance = pts => pts.reduce((d,p,i)=> i ? d + haversine(pts[i-1], p) : 0, 0);
const calcCalories = (m, s, w=70) => { const km=m/1000, h=s/3600, v=h?km/h:0; const MET = v>=10?10 : v>=8?8 : v>=6?6 : v>=4?3.5 : 2.8; return MET*w*h; };

// Simple retry helper for transient failures (e.g., cold start, network hiccups)
const retry = async (fn, retries = 3, baseDelayMs = 800) => {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      // Exponential backoff: baseDelay * (attempt + 1)
      await new Promise(res => setTimeout(res, baseDelayMs * (attempt + 1)));
    }
  }
  throw lastError;
};

  // Helper functions for color manipulation
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  
function hexToRgb(hex){
  const h = (hex || '#6aa2ff').replace('#','');
  const ok = h.length === 6 ? h : '6aa2ff';
  return { r: parseInt(ok.slice(0,2),16), g: parseInt(ok.slice(2,4),16), b: parseInt(ok.slice(4,6),16) };
}
function rgba(hex, alpha){ 
  const {r,g,b} = hexToRgb(hex); 
  // For Android compatibility, return rgba strings for WebMapView
  if (Platform.OS === 'android') {
    // Return rgba string for WebMapView compatibility
    return `rgba(${r},${g},${b},${clamp(alpha,0,1)})`;
  }
  return `rgba(${r},${g},${b},${clamp(alpha,0,1)})`; 
}

// Android-compatible color helper for WebMapView (returns rgba strings for consistency)
function androidColor(hex, alpha) {
  if (Platform.OS === 'android') {
    const {r,g,b} = hexToRgb(hex);
    // Android needs higher alpha values for better visibility
    const adjustedAlpha = Math.min(alpha * 1.3, 1.0); // Boost alpha by 30% for Android
    // Return rgba string for WebMapView compatibility
    return `rgba(${r},${g},${b},${clamp(adjustedAlpha,0,1)})`;
  }
  return hex; // iOS can handle hex colors fine
}

// Android-compatible stroke color helper for WebMapView (returns rgba strings for consistency)
function androidStrokeColor(hex, alpha) {
  if (Platform.OS === 'android') {
    const {r,g,b} = hexToRgb(hex);
    // Android stroke colors need to be more visible
    const adjustedAlpha = Math.min(alpha * 1.5, 1.0); // Boost alpha by 50% for Android strokes
    // Return rgba string for WebMapView compatibility
    return `rgba(${r},${g},${b},${clamp(adjustedAlpha,0,1)})`;
  }
  return hex; // iOS can handle hex colors fine
}
function polygonFromCell(h3id){
  try{
    const boundary = h3.cellToBoundary(h3id);
    if (!boundary || boundary.length < 3) return null;
    const coords = boundary.map(([lat,lon]) => ({ latitude: lat, longitude: lon }));
    coords.push({ ...coords[0] }); // Close the polygon
    return coords;
  }catch(e){ 
    return null; 
  }
}
function useTheme(isDark){
  return {
    isDark,
    bg: isDark ? '#0b0e1a' : '#f5f6fa',
    card: isDark ? '#161a2b' : '#ffffff',
    border: isDark ? '#1f2338' : '#e1e5f0',
    text: isDark ? '#ffffff' : '#1a1d2e',
    sub: isDark ? '#9aa0bb' : '#4a4f6a',
    primary: '#4f7df3',
    ghostText: isDark ? '#cbd0e6' : '#3a3f5a',
    ghostBorder: isDark ? '#3a3f5a' : '#d1d8f0',
    danger: '#e25555',
    headerGrad: isDark ? ['#141a2e','#0f1220'] : ['#eef2ff','#e8ecff'],
  };
}

/* ------------------ UI ATOMS ------------------ */
const BrandHeader = ({ subtitle, onOpenGroups, onOpenLeaderboard, onOpenProfile, theme, showGroupsButton, showLeaderboardButton, showProfileButton, conquestMode, sharedHexagonsCount }) => (
  <View style={[
    styles.header, 
    { 
      backgroundColor: theme.isDark ? 'rgba(22, 26, 43, 0.95)' : 'rgba(248, 250, 255, 0.95)',
      borderBottomColor: theme.isDark ? 'rgba(79, 125, 243, 0.2)' : 'rgba(79, 125, 243, 0.15)',
      borderBottomWidth: 1,
      shadowColor: theme.isDark ? '#000' : '#666',
      zIndex: 2000,
      elevation: 2000
    }
  ]}>
    {/* Main header with title */}
    <View style={{alignItems:'center', paddingTop: Platform.select({ ios: 16, android: 40 }), paddingBottom: 16}}>
      <Text style={[
        styles.brand, 
        { 
          color: theme.isDark ? '#ffffff' : '#0a0a0a'
        }
      ]}>Clash of Trails</Text>
      {subtitle ? <Text style={[
        styles.subtitle, 
        { 
          color: theme.isDark ? '#cccccc' : '#666666'
        }
      ]}>{subtitle}</Text> : null}
      {conquestMode && (
        <Text style={[styles.conquestMode, { color: '#ff6b6b', fontWeight: 'bold' }]}>
          🎯 CONQUEST MODE - Claiming across ALL groups!
        </Text>
      )}
      </View>
    </View>
);
const Card = ({ children, style, theme }) => (
  <View style={[styles.card, style, { backgroundColor: theme.card, borderColor: theme.border }]}>
    <View style={styles.cardGlow} />
    {children}
  </View>
);
const Label = ({ children, theme }) => (
  <Text style={[styles.label, { color: theme.text }]}>{children}</Text>
);
const Input = React.forwardRef(({ theme, style, ...rest }, ref) => (
  <View style={styles.inputContainer}>
  <TextInput
    ref={ref}
    placeholderTextColor={theme.sub}
    {...rest}
    style={[
      styles.input,
      style,
      { backgroundColor: theme.isDark ? '#0f1324' : '#f2f4ff', color: theme.text, borderColor: theme.border }
    ]}
  />
    <View style={[styles.inputGlow, { backgroundColor: theme.isDark ? 'rgba(79, 125, 243, 0.1)' : 'rgba(79, 125, 243, 0.05)' }]} />
  </View>
));
const PrimaryButton = ({ title, onPress, disabled, theme }) => (
  <Pressable
    onPress={async()=>{ if(disabled) return; await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress?.(); }}
    style={({pressed})=>[
      styles.buttonPrimary,
      { backgroundColor: theme.primary },
      disabled && { opacity:.45 },
      pressed && { transform:[{scale:0.95}] },
    ]}>
    <View style={styles.buttonPrimaryGradient} />
    <Text style={styles.buttonPrimaryText}>{title}</Text>
  </Pressable>
);
const GhostButton = ({ title, onPress, danger, theme, mild }) => (
  <Pressable
    onPress={async()=>{ await Haptics.selectionAsync(); onPress?.(); }}
    style={({pressed})=>[
      styles.buttonGhost,
      {
        borderColor: danger ? theme.danger : theme.ghostBorder,
        backgroundColor: mild ? (theme.isDark ? '#131933' : '#eef1ff') : 'transparent'
      },
      pressed && { transform:[{scale:0.95}] },
    ]}>
    <Text style={[styles.buttonGhostText, { color: danger ? theme.danger : theme.ghostText }]}>{title}</Text>
  </Pressable>
);

const CoolButton = ({ title, onPress, theme, type = 'refresh' }) => (
  <Pressable
    onPress={async()=>{ await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress?.(); }}
    style={({pressed})=>[
      styles.coolButton,
      {
        backgroundColor: type === 'refresh' ? theme.primary : theme.danger,
        transform: [
          { scale: pressed ? 0.95 : 1 }
        ]
      }
    ]}>
    <View style={styles.coolButtonGradient} />
    <Text style={styles.coolButtonText}>{title}</Text>
  </Pressable>
);

/* ------------------ LEADERBOARD DRAWER ------------------ */
function LeaderboardDrawer({ visible, onClose, theme, groupMembers, activeGroupId, memberHexCounts, isLoading }) {
  const translateX = useRef(new Animated.Value(400)).current;
  

  
  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : 400,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [visible]);

  // Sort members by hex count (highest first) - memoized for Android performance
  const sortedMembers = useMemo(() => {
    return [...groupMembers].sort((a, b) => {
      const aCount = memberHexCounts[a.userId] || 0;
      const bCount = memberHexCounts[b.userId] || 0;
      return bCount - aCount; // Descending order
    });
  }, [groupMembers, memberHexCounts]);
  


  return (
    <Animated.View pointerEvents={visible ? 'auto':'none'} style={[styles.drawerWrapRight, { transform:[{ translateX }] }]}>
      <View style={[styles.drawer, { backgroundColor: theme.card, borderColor: theme.border, paddingTop: Platform.select({ ios: 44, android: 60 }) }]}>
        <View style={[styles.drawerHeader, { borderBottomColor: theme.border, zIndex: 3002, elevation: 3002 }]}>
          <Text style={[styles.drawerTitle, { color: theme.text }]}>🏆 Leaderboard</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable 
              onPress={onClose} 
              style={[
                styles.drawerClose, 
                { 
                  borderColor: '#ff4757'
                }
              ]}
            >
              <Text style={{color: 'white', fontWeight:'900', fontSize: 18}}>✕</Text>
          </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
          {!activeGroupId ? (
            <Text style={[styles.cardHint, { color: theme.sub }]}>No active group selected</Text>
          ) : isLoading ? (
            <View style={{ alignItems: 'center', padding: 20 }}>
              <Text style={[styles.cardHint, { color: theme.sub }]}>🔄 Loading leaderboard...</Text>
            </View>
          ) : groupMembers.length === 0 ? (
            <Text style={[styles.cardHint, { color: theme.sub }]}>No members found</Text>
          ) : (
            <>
              {/* Member Rankings */}
              {sortedMembers.map((member, index) => {
                const hexCount = memberHexCounts[member.userId] || 0;
                const rank = index + 1;
                const isTop3 = rank <= 3;
                
                return (
              <View key={member.userId} style={[
                styles.memberRow,
                    { 
                      backgroundColor: theme.isDark ? '#0f1324' : '#eef1ff', 
                      borderColor: theme.border,
                      borderWidth: isTop3 ? 2 : 1,
                      borderColor: isTop3 ? theme.primary : theme.border
                    }
                  ]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <View style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: isTop3 ? theme.primary : theme.sub,
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Text style={{ 
                          color: theme.card, 
                          fontSize: 12, 
                          fontWeight: 'bold' 
                        }}>
                          {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8
                        }}>
                          <View style={{
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            backgroundColor: member.color,
                            borderWidth: 2,
                            borderColor: theme.card
                  }} />
                  <Text style={[styles.memberName, { color: theme.text }]}>
                    {member.displayName}
                  </Text>
                  {member.role === 'owner' && (
                    <Text style={{ color: theme.primary, fontSize: 10, fontWeight: '600' }}>OWNER</Text>
                  )}
                </View>
              </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: theme.primary, fontSize: 16, fontWeight: 'bold' }}>
                        {hexCount}
                      </Text>
                      <Text style={{ color: theme.sub, fontSize: 10 }}>
                        {hexCount === 1 ? 'hex' : 'hexes'}
                      </Text>
                      {/* Territory color indicator */}
                      <View style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: member.color,
                        borderWidth: 2,
                        borderColor: theme.card,
                        marginTop: 4
                      }} />
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

/* ------------------ PROFILE SECTION ------------------ */
function ProfileSection({ theme, user, profile, onProfileUpdate, onOpenHealthSetup }) {
  const [displayName, setDisplayName] = useState('');
  const [selectedColor, setSelectedColor] = useState(profile?.color || '#6aa2ff');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [updateSuccess, setUpdateSuccess] = useState('');
  const inputRef = useRef(null);

  // Update local state when profile changes
  useEffect(() => {
    setDisplayName(''); // keep the input empty until the user types
    setSelectedColor(profile?.color || '#6aa2ff');
  }, [profile]);

  // Prevent auto-focus when component mounts
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.blur();
    }
  }, []);

  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8C471', '#82E0AA', '#F1948A', '#E74C3C', '#D7BDE2'
  ];

  // Check if any changes have been made
  const hasChanges = () => {
    const hasDisplayNameChanged = displayName.trim().length > 0 && displayName.trim() !== (profile?.display_name || '');
    const hasColorChanged = selectedColor !== (profile?.color || '#6aa2ff');
    return hasDisplayNameChanged || hasColorChanged;
  };

  const updateProfile = async () => {
    if (!user?.id) {
      setUpdateError('User not available.');
      return;
    }
    
    // Check if anything has changed
    const hasDisplayNameChanged = displayName.trim().length > 0 && displayName.trim() !== (profile?.display_name || '');
    const hasColorChanged = selectedColor !== (profile?.color || '#6aa2ff');
    
    if (!hasDisplayNameChanged && !hasColorChanged) {
      setUpdateError('No changes detected. Please modify at least one field.');
      return;
    }
    
    setIsUpdating(true);
    setUpdateError('');
    
    try {
      // Only update fields that have changed
      const updateData = { id: user.id };
      if (hasDisplayNameChanged) {
        updateData.display_name = displayName.trim();
      }
      if (hasColorChanged) {
        updateData.color = selectedColor;
      }
      
      const { data, error } = await supabase
        .from('profiles')
        .upsert(updateData, {
          onConflict: 'id'
        });

      if (error) {
        throw error;
      }
      
      // Show success message
      const changes = [];
      if (hasDisplayNameChanged) changes.push('display name');
      if (hasColorChanged) changes.push('color');
      setUpdateSuccess(`${changes.join(' and ')} updated successfully!`);
      setUpdateError('');
      
      // Refresh profile data
      onProfileUpdate();
      
      // Clear the form
      setDisplayName(profile?.display_name || '');
      
      // Clear success message after 3 seconds
      setTimeout(() => setUpdateSuccess(''), 3000);
      
      // Profile updated successfully - leaderboard will refresh automatically
      // through the onProfileUpdate callback
      
    } catch (error) {
      setUpdateError(`Failed to update profile: ${error.message || 'Unknown error'}`);
      setUpdateSuccess('');
    } finally {
      setIsUpdating(false);
    }
  };

  if (!user) return null;

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 12 }}>
        <Text style={[styles.cardHint, { color: theme.sub }]}>Current User Name</Text>
        <View style={{
          backgroundColor: theme.isDark ? '#1a1f2e' : '#f0f2ff',
          padding: 16,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.border
        }}>
          <Text style={[styles.cardTitle, { color: theme.text, fontSize: 18 }]}>{profile?.display_name || 'Not set'}</Text>
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <Text style={[styles.cardHint, { color: theme.sub }]}>New User Name</Text>
        <Input 
          theme={theme} 
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Enter user name"
          autoFocus={false}
          blurOnSubmit={true}
          editable={true}
          ref={inputRef}
        />
      </View>

      <View style={{ gap: 12 }}>
        <Text style={[styles.cardHint, { color: theme.sub }]}>Current Territory Color</Text>
        <View style={{
          backgroundColor: theme.isDark ? '#1a1f2e' : '#f0f2ff',
          padding: 16,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16
        }}>
          <View style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: profile?.color || '#6aa2ff',
            borderWidth: 3,
            borderColor: theme.border,
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: {width: 0, height: 4},
            elevation: 6
          }} />
          <Text style={[styles.cardTitle, { color: theme.text, fontSize: 16 }]}>{profile?.color || '#6aa2ff'}</Text>
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <Text style={[styles.cardHint, { color: theme.sub }]}>New Territory Color</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {colors.map((color) => (
            <Pressable
              key={color}
              onPress={() => setSelectedColor(color)}
              style={[
                {
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: color,
                  borderWidth: 4,
                  borderColor: selectedColor === color ? theme.primary : 'transparent',
                  shadowColor: '#000',
                  shadowOpacity: 0.2,
                  shadowRadius: 6,
                  shadowOffset: {width: 0, height: 3},
                  elevation: 4
                }
              ]}
            />
          ))}
        </View>
        <Text style={[styles.cardHint, { color: theme.sub, fontSize: 12, fontStyle: 'italic' }]}>
          💡 Tip: You can update just the color without changing the display name
        </Text>
      </View>
      
      {/* Health Profile Section */}
      <View style={{ 
        borderTopWidth: 1, 
        borderTopColor: theme.border, 
        paddingTop: 20, 
        marginTop: 20 
      }}>
        <Text style={[styles.cardTitle, { color: theme.text, fontSize: 18, marginBottom: 16 }]}>
          🏃‍♂️ Health Profile
        </Text>
        
        {/* Current Health Data Display */}
        <View style={{ gap: 16, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardHint, { color: theme.sub, fontSize: 12 }]}>Height</Text>
              <Text style={[styles.cardTitle, { color: theme.text, fontSize: 16 }]}>
                {profile?.height_cm ? `${profile.height_cm} cm` : 'Not set'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardHint, { color: theme.sub, fontSize: 12 }]}>Weight</Text>
              <Text style={[styles.cardTitle, { color: theme.text, fontSize: 16 }]}>
                {profile?.weight_kg ? `${profile.weight_kg} kg` : 'Not set'}
              </Text>
            </View>
          </View>
          
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardHint, { color: theme.sub, fontSize: 12 }]}>Age</Text>
              <Text style={[styles.cardTitle, { color: theme.text, fontSize: 16 }]}>
                {profile?.age ? `${profile.age} years` : 'Not set'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardHint, { color: theme.sub, fontSize: 12 }]}>Activity Level</Text>
              <Text style={[styles.cardTitle, { color: theme.text, fontSize: 16 }]}>
                {profile?.activity_level ? profile.activity_level.charAt(0).toUpperCase() + profile.activity_level.slice(1) : 'Not set'}
              </Text>
            </View>
          </View>
        </View>
        
        {/* Health Profile Update Button */}
        <Pressable
          style={[
            styles.buttonPrimary,
            { 
              backgroundColor: theme.isDark ? '#1a1f2e' : '#f0f2ff',
              borderWidth: 1,
              borderColor: theme.border
            }
          ]}
          onPress={() => {
            // Open health setup for existing users to update their data
            onOpenHealthSetup();
          }}
        >
          <Text style={[styles.buttonPrimaryText, { color: theme.text }]}>
            Update Health Profile
          </Text>
        </Pressable>
      </View>
      


      {updateError ? (
        <Text style={[styles.cardHint, { color: theme.danger }]}>{updateError}</Text>
      ) : null}
      
      {updateSuccess ? (
        <Text style={[styles.cardHint, { color: theme.primary }]}>{updateSuccess}</Text>
      ) : null}

      <PrimaryButton
        theme={theme}
        title={isUpdating ? "Updating..." : "Update Profile"}
        onPress={updateProfile}
        disabled={isUpdating || !hasChanges()}
      />
    </View>
  );
}

/* ------------------ GROUPS DRAWER (DIRECT DB) ------------------ */
function GroupsDrawer({ visible, onClose, activeGroupId, onSelectGroup, theme, refreshCells, userId, leaveGroup: onLeaveGroup }) {
  const [groups, setGroups] = useState([]);
  const [newName, setNewName] = useState('My Crew');
  const [joinName, setJoinName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [longPressedGroup, setLongPressedGroup] = useState(null);
  const [leaveButtonAnim] = useState(new Animated.Value(0));

  const translateX = useRef(new Animated.Value(-400)).current;
  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : -400,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [visible]);

          const fetchProfile = useCallback(async () => {
      if (!userId) return;
      
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('display_name, color, height_cm, weight_kg, age, activity_level')
          .eq('id', userId)
          .single();
        
        if (error) throw error;
        if (data) setProfile(data);
        
      } catch (error) {
        // Silently handle error for production
      }
    }, [userId]);

  const fetchGroups = useCallback(async ()=>{
    try {
      setIsLoading(true);
      setError(null);
      
      if (!userId) {
        setGroups([]);
        return;
      }

    const { data, error } = await supabase
      .from('group_members')
      .select('group_id, groups(name)')
      .eq('user_id', userId)
      .order('joined_at', { ascending: true });
        
      if (error) {
        throw error;
      }
      
      const formattedGroups = (data || []).map(r => ({ 
        id: r.group_id, 
        name: r.groups?.name || 'Group' 
      }));
      
      setGroups(formattedGroups);
    } catch (error) {
      setError('Failed to fetch groups: ' + error.message);
      setGroups([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);
  useEffect(()=>{ 
    if(visible) {
      fetchGroups();
      fetchProfile();
    }
  }, [visible, fetchGroups, fetchProfile]);

  const afterSelect = async (gid) => { 
    try {
      onSelectGroup(gid); 
      onClose(); 
      
      if (refreshCells) {
        await refreshCells();
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to select group: ' + error.message);
    }
  };

  const handleLongPress = (group) => {
    setLongPressedGroup(group);
    // Fast spring animation
    Animated.spring(leaveButtonAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 120,
      friction: 8,
      restDisplacementThreshold: 0.01,
      restSpeedThreshold: 0.01,
    }).start();
    
    // Add haptic feedback for better UX
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const handleLeaveGroup = async (groupId) => {
    try {
      await onLeaveGroup(groupId);
      setLongPressedGroup(null);
      // Animate the leave button out
      Animated.timing(leaveButtonAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } catch (error) {
      // Error is already handled in onLeaveGroup function
    }
  };

  const handlePress = (gid) => {
    // If long press is active, dismiss it and don't select the group
    if (longPressedGroup) {
      setLongPressedGroup(null);
      // Animate the leave button out
      Animated.timing(leaveButtonAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      return;
    }
    afterSelect(gid);
  };

  const createGroup = async ()=>{
    try{
      setIsLoading(true);
      setError(null);
      
      const name = newName.trim();
      if (!name) return Alert.alert('Missing name','Enter a group name.');
      
      // Additional validation
      if (name.length < 2) return Alert.alert('Name too short','Group name must be at least 2 characters long.');
      if (name.length > 50) return Alert.alert('Name too long','Group name must be less than 50 characters.');
      
      // Check for invalid characters (optional - you can customize this)
      const invalidChars = /[<>:"/\\|?*]/;
      if (invalidChars.test(name)) {
        return Alert.alert('Invalid characters','Group name contains invalid characters. Please use only letters, numbers, spaces, and common punctuation.');
      }
      
      // Get current auth user to ensure we have the right ID
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError) throw new Error('Authentication error: ' + authError.message);
      if (!authUser) throw new Error('Not authenticated');
      
      // Check if group name already exists (case-insensitive)
      const { data: existingGroups, error: checkError } = await supabase
        .from('groups')
        .select('id, name')
        .ilike('name', name); // Case-insensitive search
      
      if (checkError) {
        throw new Error('Failed to check existing groups: ' + checkError.message);
      }
      
      if (existingGroups && existingGroups.length > 0) {
        throw new Error(`Group name "${name}" already exists. Please choose a different name.`);
      }
      
      // Also check for similar names to help user choose
      const { data: similarGroups, error: similarError } = await supabase
        .from('groups')
        .select('name')
        .or(`name.ilike.%${name}%,name.ilike.${name}%,name.ilike.%${name}`)
        .limit(5);
      
      if (!similarError && similarGroups && similarGroups.length > 0) {
        const suggestions = similarGroups.map(g => g.name).join(', ');
      }
      
      // Get user's profile to use their display name
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', authUser.id)
        .single();
      
      // Ensure profile exists before creating group
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: authUser.id,
        display_name: userProfile?.display_name || `Player${Date.now().toString().slice(-4)}`,
        color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
        group_id: null // Will be set when group is created
      }, { onConflict: 'id' });

      if (profileError) {
        // Continue anyway - profile might already exist
      }

      // Create group with auth user ID
      const { data: groupData, error: groupError } = await supabase.from('groups').insert({ 
        name, 
        created_by: authUser.id 
      }).select('id').single();
      
      if (groupError) {
        // Handle specific database errors
        if (groupError.code === '23505') {
          // Unique constraint violation
          throw new Error(`Group name "${name}" already exists. Please choose a different name.`);
        } else if (groupError.code === '23503') {
          // Foreign key constraint violation
          throw new Error('Failed to create group: Invalid user reference. Please try again.');
        } else {
          throw new Error('Failed to create group: ' + groupError.message);
        }
      }
      
      const gid = groupData?.id;
      if (!gid) throw new Error('No group id returned');

      // Ensure membership (owner)
      const { error: membershipError } = await supabase.from('group_members').insert({
        group_id: gid, 
        user_id: authUser.id, 
        role: 'owner'
      });
      
      if (membershipError) {
        throw new Error('Failed to add membership: ' + membershipError.message);
      }

      // Refresh groups and select the new one
      await fetchGroups();
      onSelectGroup(gid);
      Alert.alert('Group created', `Created and joined "${name}"`);
      setNewName('My Crew'); // Reset to default
    }catch(e){
      setError(e.message ?? String(e));
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const joinByName = async ()=>{
    try{
      setIsLoading(true);
      setError(null);
      
      const n = joinName.trim();
      if(!n) return Alert.alert('Missing name','Enter a group name.');

      // First check if group exists
      const { data: groups, error: groupError } = await supabase.from('groups').select('id,name').eq('name', n);
      if(groupError) throw new Error('Database error: ' + groupError.message);
      if(!groups || groups.length === 0) throw new Error(`Group "${n}" not found.`);

      const gid = groups[0].id;

      // Get current auth user
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if(authError) throw new Error('Authentication error: ' + authError.message);
      if(!authUser) throw new Error('Not authenticated');

      // Check if already a member
      const { data: existingMembership, error: checkError } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', gid)
        .eq('user_id', authUser.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
        // Silent error handling
      }

      if (existingMembership) {
        throw new Error('You are already a member of this group');
      }

      // Get user's profile to use their display name
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', authUser.id)
        .single();

      // Ensure profile exists before joining group
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: authUser.id,
        display_name: userProfile?.display_name || `Player${Date.now().toString().slice(-4)}`,
        color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
        group_id: gid // Set the group ID when joining
      }, { onConflict: 'id' });

      if (profileError) {
        // Continue anyway
      }

      // Add membership
      const { error: membershipError } = await supabase.from('group_members').insert({
        group_id: gid, 
        user_id: authUser.id, 
        role: 'member'
      });
      
      if(membershipError) throw new Error('Failed to join group: ' + membershipError.message);

      await fetchGroups();
      onSelectGroup(gid);
      Alert.alert('Joined', `You're in "${n}"`);
      setJoinName(''); // Clear the input
    }catch(e){
      setError(e.message ?? String(e));
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setIsLoading(false);
    }
  };



  return (
    <Animated.View pointerEvents={visible ? 'auto':'none'} style={[styles.drawerWrap, { transform:[{ translateX }] }]}>
      <View style={[styles.drawer, { backgroundColor: theme.card, borderColor: theme.border, paddingTop: Platform.select({ ios: 44, android: 60 }) }]}>
        <View style={[styles.drawerHeader, { borderBottomColor: theme.border, zIndex: 3002, elevation: 3002 }]}>
          <Text style={[styles.drawerTitle, { color: theme.text }]}>Your Groups</Text>
          <Pressable 
            onPress={onClose} 
            style={[
              styles.drawerClose, 
              { 
                borderColor: '#ff4757'
              }
            ]}
          >
            <Text style={{color: 'white', fontWeight:'900', fontSize: 18}}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>


          {groups.map(g => (
            <View key={g.id} style={{ position: 'relative' }}>
              <Pressable 
                onPress={() => handlePress(g.id)}
                onLongPress={() => handleLongPress(g)}
                style={[
              styles.groupRow,
                  { 
                    backgroundColor: theme.isDark ? '#0f1324' : '#eef1ff', 
                    borderColor: activeGroupId===g.id ? theme.primary : theme.border,
                    // Add subtle highlight when long pressed
                    opacity: longPressedGroup?.id === g.id ? 0.95 : 1,
                    transform: [
                      {
                        scale: longPressedGroup?.id === g.id ? 0.99 : 1
                      }
                    ],
                    // Add border highlight when long pressed
                    borderWidth: longPressedGroup?.id === g.id ? 1.5 : 1,
                    borderColor: longPressedGroup?.id === g.id ? '#ff4757' : (activeGroupId===g.id ? theme.primary : theme.border)
                  }
                ]}
              >
              <Text style={[styles.groupName, { color: theme.text }]}>{g.name}</Text>
              {activeGroupId===g.id ? <Text style={{ color: theme.primary, fontWeight:'800' }}>Active</Text> : null}
            </Pressable>
              
              {/* Cool Animated Leave Button - Below Group Row */}
              {longPressedGroup?.id === g.id && (
                <Animated.View
                  style={[
                    styles.leaveButtonContainerBelow,
                    {
                      opacity: leaveButtonAnim,
                      transform: [
                        {
                          scale: leaveButtonAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.5, 1]
                          })
                        },
                        {
                          translateY: leaveButtonAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [20, 0]
                          })
                        }
                      ]
                    }
                  ]}
                >
                  <Pressable
                    onPress={() => handleLeaveGroup(g.id)}
                    style={[
                      styles.leaveButton,
                      { backgroundColor: '#ff4757', borderColor: '#ff4757' }
                    ]}
                  >
                    <Text style={styles.leaveButtonText}>🚪 Leave Group</Text>
                  </Pressable>
                </Animated.View>
              )}
            </View>
          ))}

          <View style={[styles.sectionDivider, { backgroundColor: theme.border }]}/>

          <Text style={[styles.sectionTitle, { color: theme.text }]}>Create a group</Text>
          <Input theme={theme} value={newName} onChangeText={setNewName}/>
          <PrimaryButton theme={theme} title={isLoading ? "Creating..." : "Create"} onPress={createGroup} disabled={isLoading}/>

          <Text style={[styles.sectionTitle, { color: theme.text, marginTop:12 }]}>Join by name</Text>
          <Input theme={theme} value={joinName} onChangeText={setJoinName} autoCapitalize="none" placeholder="Exact group name"/>
          <GhostButton theme={theme} title={isLoading ? "Joining..." : "Join"} onPress={joinByName} disabled={isLoading}/>
          

          <GhostButton theme={theme} title="Refresh Groups" onPress={fetchGroups} mild />
        </ScrollView>
      </View>
    </Animated.View>
  );
}

/* ------------------ CAPTURE WRITERS ------------------ */
async function captureCells(cells, groupId, userId) {
  if (!cells || cells.length === 0 || !groupId || !userId) {
    return;
  }
  
  try {
    // Use the modern schema with user_id
    const cellData = cells.map(cell => ({
      h3_id: cell,
      group_id: groupId,
      user_id: userId
    }));

    const { error } = await supabase
      .from('captured_cells')
      .upsert(cellData, {
        onConflict: 'h3_id,group_id',
        ignoreDuplicates: false
      });

    if (error) {
      // If it's a schema error, try to understand what's wrong
      if (error.code === '42703') {
        const { data: columns, error: schemaError } = await supabase
          .rpc('get_table_columns', { table_name: 'captured_cells' });
      }
      
      throw error;
    }
    
  } catch (error) {
    throw error;
  }
}
async function captureTerritoryGlobal(points, groupId, userId) {
  try {
    if (!points || points.length === 0 || !groupId || !userId) return;
    const uniq = new Set();
    for (const p of points) uniq.add(h3.latLngToCell(p.lat, p.lon, H3_RES));
    const cells = Array.from(uniq);
    await captureCells(cells, groupId, userId);
  } catch (e) {
    // Silently handle error for production
  }
}

/* ------------------ MAIN APP ------------------ */
export default function App(){
  // Android performance optimizations
  const performanceConfig = usePerformance();
  
  const [isDark, setIsDark] = useState(true);
  const theme = useTheme(isDark);

  // auth
  const [user,setUser]=useState(null);
  const [profile,setProfile]=useState(null);
  const [email,setEmail]=useState('');
  const [displayName,setDisplayName]=useState('');
  const [password,setPassword]=useState('');

  // groups
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState([]);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
  const [groups, setGroups] = useState([]);

  // tracking
  const [isTracking,setIsTracking]=useState(false);
  const [conquestMode, setConquestMode] = useState(false); // New conquest mode state
  const [points,setPoints]=useState([]);
  const [startTime,setStartTime]=useState(0);
  const [elapsed,setElapsed]=useState(0);
  const watchId=useRef(null);

  // map/grid
  const mapRef = useRef(null);
  const webMapRef = useRef(null);
  const [initialRegion, setInitialRegion] = useState(null);
  const [cells, setCells] = useState([]);
  const [allHexGrid, setAllHexGrid] = useState(new Set()); // Persistent hex grid
  const [claimedCells, setClaimedCells] = useState(new Set()); // Track claimed cells
  const [memberHexCounts, setMemberHexCounts] = useState({}); // Track hex counts for each member
  const [sharedHexagons, setSharedHexagons] = useState(new Map()); // Track shared hexagons for visual display
  const [localClaimedHexes, setLocalClaimedHexes] = useState(new Set()); // Local hexes while walking
  const [dailySteps, setDailySteps] = useState(0);
  const [dailyCalories, setDailyCalories] = useState(0);
  const [selectedHexInfo, setSelectedHexInfo] = useState(null);
  const [hexInfoModalVisible, setHexInfoModalVisible] = useState(false);
  const [showHealthSetup, setShowHealthSetup] = useState(false);
  const [hasCompletedHealthSetup, setHasCompletedHealthSetup] = useState(false);
  const [hasShownHealthSetup, setHasShownHealthSetup] = useState(false);
  const [pedometerAvailable, setPedometerAvailable] = useState(false);
  const [realStepCount, setRealStepCount] = useState(0);
  const [realCalories, setRealCalories] = useState(0);
  const [sessionSteps, setSessionSteps] = useState(0);
  const [sessionCalories, setSessionCalories] = useState(0);
  const [pedometerSubscription, setPedometerSubscription] = useState(null);
  const [lastStepCount, setLastStepCount] = useState(0);
  const lastStepCountRef = useRef(0);
  
  // Performance optimization: Simple memoization for all platforms
  const memoizedCells = useMemo(() => cells, [cells]);
  
  // OTA Update checking
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  
  // Background location tracking state
  const [backgroundLocationEnabled, setBackgroundLocationEnabled] = useState(false);
  const [locationPermissionStatus, setLocationPermissionStatus] = useState(null);
  const backgroundLocationTaskRef = useRef(null);
  const locationSubscriptionRef = useRef(null);
  



  // live capture throttle + debounce
  const lastCellRef = useRef(null);
  const lastCommitAtRef = useRef(0);
  const fetchCellsTimer = useRef(null);
  const lastGridUpdateRef = useRef(0);
  const lastGridExpansionRef = useRef(0);
  const gridExpansionTimeoutRef = useRef(null);
  const locationIntervalRef = useRef(null); // New ref for setInterval
  const locationCounterRef = useRef(0); // Counter for location updates
  const isTrackingRef = useRef(false); // Ref to track tracking state
  const stepCheckIntervalRef = useRef(null); // Ref for step check interval
  const subscriptionStepsRef = useRef(0); // Steps since subscription started
  
  // Performance optimization: Consistent update frequency
  const updateThrottle = 500; // 0.5 seconds for all platforms
  
  // Performance optimization: Simple debounce for all platforms
  const mapUpdateDebounceRef = useRef(null);
  const debouncedMapUpdate = useCallback((updateFn) => {
    if (mapUpdateDebounceRef.current) {
      clearTimeout(mapUpdateDebounceRef.current);
    }
    mapUpdateDebounceRef.current = setTimeout(updateFn, 100); // Faster response
  }, []);
  
  // Map performance: Simple configuration for all platforms
  const mapConfig = useMemo(() => ({
    // Reasonable polygon count for all platforms
    maxPolygons: 500,
    // Consistent update frequency
    updateInterval: 1000,
    // Keep full quality
    simplifyPolygons: false,
    // Consistent resolution
    hexResolution: 9,
  }), []);
  
  // Helper function to process all hexagons - defined BEFORE it's used
  const processAllHexagons = useCallback((hexGrid, cells, claimedCells, localClaimedHexes, sharedHexagons, user, profile) => {
    // Create lookup maps for O(1) access instead of O(n) searches
    const cellsMap = new Map(cells.map(c => [c.h3_id, c]));
    const claimedSet = new Set(claimedCells);
    const localClaimedSet = new Set(localClaimedHexes);
    
    // Check if this hexagon is shared between multiple users
    const isHexShared = (hexId) => {
      const sharedUsers = sharedHexagons.get(hexId);
      const isShared = sharedUsers && sharedUsers.length > 1;
      return isShared;
    };
    
    const result = Array.from(hexGrid).map(hexId => {
      if (!hexId) return null;
      
      // Generate coordinates for this hex
      const coords = polygonFromCell(hexId);
      if (!coords) return null;
      
      const isClaimed = claimedSet.has(hexId);
      const isLocalClaimed = localClaimedSet.has(hexId);
      
      // O(1) lookup instead of O(n) search
      const ownerCell = cellsMap.get(hexId);
      const isOwned = !!ownerCell;
      const isMine = ownerCell?.user_id === user?.id;
      
      // Priority: Local Claimed > Claimed > Owned > Unclaimed
      if (isLocalClaimed) {
        // Locally claimed while walking - most prominent with pulsing effect
        const base = profile?.color || '#6aa2ff';
        
        return {
          id: hexId,
          coords: coords,
          fill: rgba(base, 0.8), // Very opaque for local claims
          stroke: rgba(base, 1.0), // Solid border
          strokeWidth: 4, // Consistent border width
          type: 'local-claimed',
          subtype: 'walking'
        };
      } else if (isOwned) {
        // Check if this is a shared hexagon first
        if (isHexShared(hexId)) {
          // Shared territory - use unique purple/magenta color that no user can have
          const sharedUsers = sharedHexagons.get(hexId);
          const isMySharedTerritory = sharedUsers.includes(user?.id);
          
          return {
            id: hexId,
            coords: coords,
            fill: 'rgba(128, 0, 128, 0.6)', // Unique purple/magenta for shared territory
            stroke: 'rgba(128, 0, 128, 0.9)', // Solid purple/magenta border
            strokeWidth: 4, // Thicker border for shared territory
            type: 'shared',
            subtype: isMySharedTerritory ? 'mine-shared' : 'other-shared',
            sharedUsers: sharedUsers,
            primaryOwner: ownerCell?.user_id,
            ownerColor: ownerCell?.userColor || '#6aa2ff'
          };
        }
        
        // Regular owned territory (not shared) - use the ACTUAL owner's color
        const ownerColor = ownerCell?.userColor;
        
        const base = ownerColor || '#6aa2ff'; // Fallback to blue if no color
        const isMyTerritory = ownerCell?.user_id === user?.id;
        
        if (isMyTerritory) {
          // My territory - solid and prominent
          return {
            id: hexId,
            coords: coords,
            fill: rgba(base, 0.6), // Consistent opacity for my territory
            stroke: rgba(base, 1.0), // Solid border
            strokeWidth: 3, // Consistent border width
            type: 'my-territory',
            subtype: 'owned'
          };
        } else {
          // Other user's territory - use their color with medium opacity
          return {
            id: hexId,
            coords: coords,
            fill: rgba(base, 0.3), // Consistent opacity for other territory
            stroke: rgba(base, 0.9), // Strong border in their color
            strokeWidth: 2.5, // Consistent border width
            type: 'other-territory',
            subtype: 'owned',
            owner: ownerCell?.user_id,
            ownerColor: base
          };
        }
      } else if (isClaimed) {
        // Claimed but not yet owned - use medium opacity
        const base = profile?.color || '#6aa2ff';
        
        return {
          id: hexId,
          coords: coords,
          fill: rgba(base, 0.5), // Medium opacity
          stroke: rgba(base, 0.8), // Medium border
          strokeWidth: Platform.OS === 'android' ? 3 : 2, // Medium border thickness
          type: 'claimed',
          subtype: 'pending'
        };
      } else {
        // Unclaimed hexagon - subtle grid appearance
        return {
          id: hexId,
          coords: coords,
          fill: Platform.OS === 'android'
            ? (theme.isDark ? 'rgba(100, 110, 130, 0.15)' : 'rgba(200, 210, 230, 0.2)') // Android rgba
            : (theme.isDark ? 'rgba(100, 110, 130, 0.2)' : 'rgba(200, 210, 230, 0.3)'), // iOS rgba
          stroke: Platform.OS === 'android'
            ? (theme.isDark ? 'rgba(160, 170, 190, 0.9)' : 'rgba(140, 150, 170, 0.9)') // Android rgba
            : (theme.isDark ? 'rgba(160, 170, 190, 0.8)' : 'rgba(140, 150, 170, 0.8)'), // iOS rgba
          strokeWidth: 1.5, // Slightly thicker for visibility
          type: 'unclaimed'
        };
      }
    }).filter(Boolean);
    
    return result;
  }, []);

  // Enhanced bottom sheet with pull-up functionality
  const sheetY = useRef(new Animated.Value(0)).current;
  const sheetHeight = useRef(new Animated.Value(200)).current;
  const isExpanded = useRef(false);
  
  // Animation configuration: Consistent across platforms
  const animationConfig = useMemo(() => ({
    duration: 300,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true
  }), []);
  
  // Hex info modal functionality
  const handleHexTap = async (hexId) => {
    try {
      // First get the captured cells data
      const { data: hexData, error: hexError } = await supabase
        .from('captured_cells')
        .select('h3_id, group_id, user_id, captured_at')
        .eq('h3_id', hexId)
        .eq('group_id', activeGroupId);
      
      if (hexError) throw hexError;
      
      if (hexData && hexData.length > 0) {
        // Get user profiles for the hex owners
        const userIds = hexData.map(item => item.user_id);
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, display_name, color')
          .in('id', userIds);
        
        if (profileError) throw profileError;
        
        // Check if it's a shared hex (multiple users)
        const isShared = hexData.length > 1;
        
        // Combine hex data with profile data
        const owners = hexData.map(hexItem => {
          const profile = profileData.find(p => p.id === hexItem.user_id);
          return {
            displayName: profile?.display_name || 'Unknown User',
            color: profile?.color || '#6aa2ff',
            capturedAt: hexItem.captured_at
          };
        });
        
        setSelectedHexInfo({
          hexId,
          isShared,
          owners,
          groupName: groups.find(g => g.id === activeGroupId)?.name || 'Unknown Group'
        });
        
        setHexInfoModalVisible(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (error) {
      console.error('Error fetching hex info:', error);
    }
  };
  
  // Modal animation values
  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalScale = useRef(new Animated.Value(0.8)).current;
  
  // Health tracking setup
  useEffect(() => {
    const checkPedometerAvailability = async () => {
      try {
        const isAvailable = await Pedometer.isAvailableAsync();
        setPedometerAvailable(isAvailable);
        // console.log('👟 Pedometer available:', isAvailable);
      } catch (error) {
        setPedometerAvailable(false);
        // console.log('❌ Pedometer not available:', error.message);
      }
    };
    
    checkPedometerAvailability();
    
    // Set up periodic daily reset check (every hour)
    const dailyResetInterval = setInterval(() => {
      resetDailyFitness();
    }, 60 * 60 * 1000); // Check every hour
    
    return () => {
      clearInterval(dailyResetInterval);
      // Clean up pedometer subscription if it exists
      if (pedometerSubscription) {
        pedometerSubscription.remove();
      }
    };
  }, [resetDailyFitness, pedometerSubscription]);
  
  // OTA Update checking
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        setIsCheckingUpdate(true);
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          setUpdateAvailable(true);
          console.log('🔄 Update available:', update.manifest?.version || 'Unknown version');
          
          // Auto-download update for better user experience
          try {
            console.log('📥 Auto-downloading update...');
            await Updates.fetchUpdateAsync();
            console.log('✅ Update downloaded successfully');
          } catch (downloadError) {
            console.log('⚠️ Auto-download failed:', downloadError.message);
          }
        } else {
          console.log('✅ App is up to date');
        }
      } catch (error) {
        console.log('Update check failed:', error);
      } finally {
        setIsCheckingUpdate(false);
      }
    };
    
    // Check for updates when app starts
    checkForUpdates();
    
    // Check for updates every 30 minutes
    const updateInterval = setInterval(checkForUpdates, 30 * 60 * 1000);
    
    return () => clearInterval(updateInterval);
  }, []);
  
  // OTA Update functions
  const applyUpdate = useCallback(async () => {
    try {
      setUpdateAvailable(false);
      setIsCheckingUpdate(true);
      setUpdateProgress(0);
      
      console.log('🔄 Applying update...');
      
      // Check if update is already downloaded
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        console.log('✅ Update ready, reloading app...');
        setUpdateProgress(100);
        setTimeout(() => Updates.reloadAsync(), 500);
      } else {
        console.log('📥 Downloading update...');
        setUpdateProgress(50);
        await Updates.fetchUpdateAsync();
        console.log('✅ Update downloaded, reloading app...');
        setUpdateProgress(100);
        setTimeout(() => Updates.reloadAsync(), 500);
      }
    } catch (error) {
      console.log('Update failed:', error);
      setUpdateAvailable(true); // Re-enable update button
      setUpdateProgress(0);
      Alert.alert('Update Failed', 'Failed to apply the update. Please try again.');
    } finally {
      setIsCheckingUpdate(false);
    }
  }, []);
  
  // Enhanced OTA update notification
  const renderOTAUpdateNotification = () => {
    if (!updateAvailable) return null;
    
    return (
      <View style={[styles.otaUpdateContainer, { 
        backgroundColor: theme.primary,
        borderColor: theme.border 
      }]}>
        <View style={styles.otaUpdateContent}>
          <Text style={[styles.otaUpdateTitle, { color: '#ffffff' }]}>
            🔄 Update Available!
          </Text>
          <Text style={[styles.otaUpdateText, { color: '#ffffff' }]}>
            A new version is ready to install
          </Text>
          
          {isCheckingUpdate && (
            <View style={styles.updateProgressContainer}>
              <View style={[styles.updateProgressBar, { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
                <View style={[styles.updateProgressFill, { 
                  backgroundColor: '#ffffff',
                  width: `${updateProgress}%`
                }]} />
              </View>
              <Text style={[styles.updateProgressText, { color: '#ffffff' }]}>
                {updateProgress}%
              </Text>
            </View>
          )}
          
          <TouchableOpacity
            style={[styles.updateButton, { 
              backgroundColor: '#ffffff',
              opacity: isCheckingUpdate ? 0.6 : 1
            }]}
            onPress={applyUpdate}
            disabled={isCheckingUpdate}
          >
            <Text style={[styles.updateButtonText, { color: theme.primary }]}>
              {isCheckingUpdate ? 'Updating...' : 'Update Now'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };
  
  // Real-time health tracking
  const startHealthTracking = useCallback(async () => {
    if (!pedometerAvailable || !isTracking) return;
    
    try {
      const subscription = Pedometer.watchStepCount((result) => {
        if (result.steps !== null) {
          setRealStepCount(prev => prev + 1);
          // Calculate calories based on user profile and real steps
          calculateRealCalories(result.steps);
        }
      });
      
      return subscription;
    } catch (error) {
      // Silently handle error for production
    }
  }, [pedometerAvailable, isTracking]);
  
  const calculateRealCalories = useCallback((steps) => {
    if (!profile) return;
    
    // Get user metrics
    const weightKg = profile.weight_kg || 70;
    const heightCm = profile.height_cm || 170;
    const age = profile.age || 25;
    const activityLevel = profile.activity_level || 'moderate';
    
    // Calculate calories using real step data and user profile
    // Based on MET values and user characteristics
    const stepLength = heightCm * 0.414; // cm per step
    const distanceM = steps * stepLength / 100; // meters
    const distanceKm = distanceM / 1000;
    
    // MET values based on walking speed (assuming moderate pace)
    const metValue = 3.5; // Moderate walking
    
    // Calculate calories: Calories = MET × Weight (kg) × Time (hours)
    // For steps, we estimate time based on average walking speed
    const avgSpeedKmh = 5; // 5 km/h average walking speed
    const timeHours = distanceKm / avgSpeedKmh;
    
    const calories = metValue * weightKg * timeHours;
    
    setRealCalories(prev => Math.round(prev + calories));
  }, [profile]);
  
  const stopHealthTracking = useCallback(() => {
    // Pedometer subscription cleanup is handled automatically
    setRealStepCount(0);
    setRealCalories(0);
  }, []);
  
  // Check if user has completed health setup
  useEffect(() => {
    if (user && profile) {
      const hasHealthData = profile.height_cm && profile.weight_kg && profile.age;
      setHasCompletedHealthSetup(!!hasHealthData);
      
      // Only show health setup for new users, and only once per session
      const isNewUser = !profile.display_name || profile.display_name === 'Player';
      if (!hasHealthData && isNewUser && !hasShownHealthSetup) {
        setShowHealthSetup(true);
        setHasShownHealthSetup(true); // Mark as shown for this session
      }
    }
  }, [user, profile, hasShownHealthSetup]);
  
  // Start/stop health tracking based on isTracking state
  useEffect(() => {
    if (isTracking && pedometerAvailable) {
      startHealthTracking();
    } else if (!isTracking) {
      stopHealthTracking();
    }
  }, [isTracking, pedometerAvailable, startHealthTracking, stopHealthTracking]);
  
  // Animate modal in/out
  useEffect(() => {
    if (hexInfoModalVisible) {
      Animated.parallel([
        Animated.timing(modalOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.spring(modalScale, {
          toValue: 1,
          tension: 100,
          friction: 8,
          useNativeDriver: false,
        })
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(modalOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.spring(modalScale, {
          toValue: 0.8,
          tension: 100,
          friction: 8,
          useNativeDriver: false,
        })
      ]).start();
    }
  }, [hexInfoModalVisible]);
  
  const toggleSheet = () => {
    const targetHeight = isExpanded.current ? 200 : 400;
    isExpanded.current = !isExpanded.current;
    
    Animated.spring(sheetHeight, {
      toValue: targetHeight,
      tension: 80,
      friction: 8,
      useNativeDriver: false
    }).start();
  };
  
  const expandSheet = () => {
    if (!isExpanded.current) {
      isExpanded.current = true;
      Animated.spring(sheetHeight, {
        toValue: 400,
        tension: 80,
        friction: 8,
        useNativeDriver: false
      }).start();
    }
  };
  
  const collapseSheet = () => {
    if (isExpanded.current) {
      isExpanded.current = false;
      Animated.spring(sheetHeight, {
        toValue: 200,
        tension: 80,
        friction: 8,
        useNativeDriver: false
      }).start();
    }
  };

  // PanResponder for smooth gesture handling - only for the pull handle
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only handle gestures on the pull handle area
        return Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        // Haptic feedback when starting gesture
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      },
      onPanResponderMove: (_, gestureState) => {
        // Smooth height adjustment during gesture
        const newHeight = isExpanded.current ? 
          Math.max(200, 400 - gestureState.dy) : 
          Math.min(400, 200 + Math.abs(gestureState.dy));
        
        sheetHeight.setValue(newHeight);
      },
      onPanResponderRelease: (_, gestureState) => {
        // Determine if should expand or collapse based on gesture
        if (Math.abs(gestureState.dy) > 30) {
          if (gestureState.dy < 0 && !isExpanded.current) {
            expandSheet();
          } else if (gestureState.dy > 0 && isExpanded.current) {
            collapseSheet();
          } else {
            // Snap back to current state
            Animated.spring(sheetHeight, {
              toValue: isExpanded.current ? 400 : 200,
              tension: 80,
              friction: 8,
              useNativeDriver: false
            }).start();
          }
        } else {
          // Snap back to current state if gesture wasn't strong enough
          Animated.spring(sheetHeight, {
            toValue: isExpanded.current ? 400 : 200,
            tension: 80,
            friction: 8,
            useNativeDriver: false
          }).start();
        }
      },
    })
  ).current;

  /* ----- auth/session bootstrap ----- */
  useEffect(()=>{
    // Seed session immediately to avoid null flashes
    supabase.auth.getSession().then(({data:{session}})=>setUser(session?.user ?? null));

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e,s)=>{
      setUser(s?.user ?? null);
      if (!s?.user) {
        setProfile(null); 
        setActiveGroupId(null);
        return;
      }

      // Ensure profile exists with a resilient retry (handles race at first app open)
      await retry(() => supabase.rpc('ensure_profile_ready', { p_display_name: s?.user?.user_metadata?.display_name || profile?.display_name || displayName || 'Player' }));

      // Fetch profile with retry to avoid cold-start race/network hiccup
      const prof = await retry(async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('display_name,color,height_cm,weight_kg,age,activity_level')
          .eq('id', s.user.id)
          .single();
        if (error) throw error;
        return data;
      });
      setProfile(prof);

      // Ensure default color exists
      if (!prof?.color) {
            await supabase.from('profiles').update({ color: '#6aa2ff' }).eq('id', s.user.id);
          }

      // Preload groups reliably so first landing shows them (avoid stale closure on first render)
      try {
        const groupsData = await retry(async () => {
          const { data, error } = await supabase
            .from('group_members')
            .select('group_id, groups(name)')
            .eq('user_id', s.user.id)
            .order('joined_at', { ascending: true });
          if (error) throw error;
          return data || [];
        });

        const formattedGroups = groupsData.map(r => ({ id: r.group_id, name: r.groups?.name || 'Group' }));
        setGroups(formattedGroups);
        if (!activeGroupId && formattedGroups.length > 0) {
          setActiveGroupId(formattedGroups[0].id);
        }
      } catch (_) {
        // Ignore, second-stage effect will retry
      }
    });
    return ()=>sub?.subscription?.unsubscribe?.();
  },[]);

  useEffect(()=>{
    if(!user) return;
    (async()=>{
      // Ensure profile is ready and fetch with retry to avoid empty home on cold start
      await retry(() => supabase.rpc('ensure_profile_ready', { p_display_name: user?.user_metadata?.display_name || profile?.display_name || displayName || 'Player' }));
      const prof = await retry(async () => {
        const { data } = await supabase
          .from('profiles')
          .select('display_name,color,height_cm,weight_kg,age,activity_level')
          .eq('id', user.id)
          .single();
        return data;
      });
      if (prof) setProfile(prof);

      // Load groups and set an initial active group when available
      await retry(async () => { await fetchUserGroups(); });
      const { data } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id)
        .order('joined_at',{ascending:true})
        .limit(1);
      if (data?.length) setActiveGroupId(data[0].group_id);

      // Fetch daily fitness data
      fetchDailyFitness();
    })();
  },[user, fetchUserGroups, fetchDailyFitness]);

  // Check if it's a new day and reset fitness data
  useEffect(() => {
    if (!user) return;
    
    const checkNewDay = async () => {
      try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const lastCheck = await AsyncStorage.getItem('lastFitnessCheck');
        
        if (lastCheck !== today) {
          await AsyncStorage.setItem('lastFitnessCheck', today);
          resetDailyFitness();
        }
      } catch (error) {
        // console.log('❌ Error checking new day:', error);
      }
    };
    
    // Check immediately
    checkNewDay();
    
    // Set up interval to check every hour
    const interval = setInterval(checkNewDay, 60 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [user, resetDailyFitness]);

  /* ----- initial location (fast-start) ----- */
  useEffect(()=>{
    (async()=>{
      try {

      const { status } = await Location.requestForegroundPermissionsAsync();
      if(status==='granted'){
          // 1) Use last known position for instant map render (may be a few minutes old)
          const last = await Location.getLastKnownPositionAsync();
          if (last?.coords) {
            const lastRegion = { latitude: last.coords.latitude, longitude: last.coords.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 };
            setInitialRegion(lastRegion);
            setTimeout(()=> mapRef.current?.animateToRegion(lastRegion, 600), 150);
            // Small grid first for quick draw
                          generateHexGrid(lastRegion.latitude, lastRegion.longitude, false, conquestMode);
            // Schedule expansion shortly after first paint
              setTimeout(() => generateHexGrid(lastRegion.latitude, lastRegion.longitude, true, conquestMode), 900);
          }

          // 2) Fetch fresh position in background with balanced accuracy
          const fresh = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            timeout: 8000,
            maximumAge: 15000
          });

          const region = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 };
        setInitialRegion(region);
          setTimeout(()=> mapRef.current?.animateToRegion(region, 700), 200);
          // Ensure grid exists near fresh position; expand instead of full regen
            generateHexGrid(region.latitude, region.longitude, true, conquestMode);
      } else {
          console.log('Location permission denied, using fallback');
          const region = { latitude: 40.7128, longitude: -74.0060, latitudeDelta: 0.02, longitudeDelta: 0.02 }; // NYC fallback
          setInitialRegion(region);
          generateHexGrid(40.7128, -74.0060, false, true);
          setTimeout(() => generateHexGrid(40.7128, -74.0060, true), 900);
        }
      } catch (error) {
        console.log('Location error:', error);
        const region = { latitude: 40.7128, longitude: -74.0060, latitudeDelta: 0.02, longitudeDelta: 0.02 }; // NYC fallback
        setInitialRegion(region);
        generateHexGrid(40.7128, -74.0060, false, true);
        setTimeout(() => generateHexGrid(40.7128, -74.0060, true), 900);
      }
    })();
  },[]);



      /* ----- generate and expand hex grid dynamically - OPTIMIZED for performance ----- */
  const generateHexGrid = useCallback((lat, lon, expand = false, isConquestMode = false) => {
    try {
      const center = h3.latLngToCell(lat, lon, H3_RES);
      
      // OPTIMIZATION: Cache radius calculations for better performance
      // In conquest mode, use much larger radius to cover all possible hexagons
      const radius = isConquestMode ? 20 : (H3_RES >= 10 ? 4 : 8);
      const maxHexes = isConquestMode ? 1000 : (H3_RES >= 10 ? 80 : 150);
      
      // OPTIMIZATION: Use gridDisk with size limit for better memory management
      const hexRing = h3.gridDisk(center, radius);
      const limitedHexRing = hexRing.slice(0, maxHexes);
      
      if (expand) {
        // OPTIMIZATION: Use functional update to avoid unnecessary re-renders
        setAllHexGrid(prevGrid => {
          // OPTIMIZATION: Use Set for O(1) lookup instead of O(n) array operations
          const newHexes = limitedHexRing.filter(h => !prevGrid.has(h));
          
          if (newHexes.length > 0) {
            return new Set([...prevGrid, ...newHexes]);
          }
          return prevGrid;
        });
      } else {
        // Initial generation - use Set for O(1) operations
        setAllHexGrid(new Set(limitedHexRing));
      }
    } catch (e) {
      console.log('generateHexGrid error:', e);
    }
  }, []);

  /* ----- check if we need to expand hex grid based on current location - OPTIMIZED ----- */
  const checkAndExpandGrid = useCallback((lat, lon) => {
    const now = Date.now();
    // OPTIMIZATION: Throttle grid expansion checks to reduce CPU usage
    if (now - lastGridExpansionRef.current < 10000) return;
    
    try {
      // OPTIMIZATION: Cache the current cell calculation
      const currentCell = h3.latLngToCell(lat, lon, H3_RES);
      
      // OPTIMIZATION: Use Set.has() for O(1) lookup instead of O(n) search
      if (!allHexGrid.has(currentCell)) {
        lastGridExpansionRef.current = now;
        
        // OPTIMIZATION: Debounce grid expansion to prevent rapid successive calls
        if (gridExpansionTimeoutRef.current) {
          clearTimeout(gridExpansionTimeoutRef.current);
        }
        
                  gridExpansionTimeoutRef.current = setTimeout(() => {
            generateHexGrid(lat, lon, true, conquestMode); // expand = true, conquest mode
          }, 100); // Small delay to batch rapid location changes
      }
    } catch (e) {
      // Silently handle error for production
    }
  }, [allHexGrid, generateHexGrid]);

  /* ----- SIMPLE hexagon fetching - just get what's in the DB ----- */
  const fetchCells = useCallback(async () => {
    if (!activeGroupId || !user?.id) return;
    
    // console.log('🔄 fetchCells called for group:', activeGroupId.slice(-8));
    
    try {
      // SIMPLE: Just get all hexagons in the current group
      const { data: groupHexagons, error: groupError } = await supabase
        .from('captured_cells')
        .select('h3_id, user_id, group_id, claimed_at')
        .eq('group_id', activeGroupId);

      if (groupError) {
        console.log('Error fetching group hexagons:', groupError);
        return;
      }
      
      if (!groupHexagons || groupHexagons.length === 0) {
        console.log('No hexagons found in group');
        setCells([]);
        setClaimedCells(new Set());
        return;
      }
      
              // console.log('🎯 Found', groupHexagons.length, 'hexagons in group');
      
      // SIMPLE: For each hexagon, find the most recent claim
      const hexagonOwnership = new Map(); // h3_id -> { user_id, claimed_at }
      
      groupHexagons.forEach(hex => {
        const existing = hexagonOwnership.get(hex.h3_id);
        if (!existing || new Date(hex.claimed_at) > new Date(existing.claimed_at)) {
          // This is the most recent claim for this hexagon
          hexagonOwnership.set(hex.h3_id, {
            h3_id: hex.h3_id,
            user_id: hex.user_id,
            group_id: hex.group_id,
            claimed_at: hex.claimed_at
          });
        }
      });
      
      const uniqueHexagons = Array.from(hexagonOwnership.values());
              // console.log('🎯 Unique hexagons after deduplication:', uniqueHexagons.length);
      
      // Set claimed cells for the grid
      const dbCellIds = uniqueHexagons.map(hex => hex.h3_id);
      setClaimedCells(new Set(dbCellIds));
      
      // SIMPLE: Get user profiles for colors
      const userIds = [...new Set(uniqueHexagons.map(hex => hex.user_id))];
      const { data: profiles, error: profileError } = await supabase
          .from('profiles')
        .select('id, color, display_name')
        .in('id', userIds);
      
      if (profileError) {
        console.log('Error fetching profiles:', profileError);
        return;
      }
      
      if (profiles && profiles.length > 0) {
        // console.log('🎨 Fetched profiles for colors:', profiles.length, 'users');
        
        // Create color map
        const profileMap = new Map(profiles.map(p => [p.id, p.color]));
        const displayNameMap = new Map(profiles.map(p => [p.id, p.display_name]));
        
        // SIMPLE: Create hexagons with colors
        const cellsWithColors = uniqueHexagons.map(hex => ({
          ...hex,
          userColor: profileMap.get(hex.user_id) || '#6aa2ff',
          displayName: displayNameMap.get(hex.user_id) || `User${hex.user_id.slice(-4)}`
        }));
        
        // console.log('🎨 Created', cellsWithColors.length, 'hexagons with colors');
        
        // SIMPLE: Check for shared hexagons (multiple users within 10 minutes)
        const sharedHexagonsMap = new Map();
        
        // Group by h3_id to find potential sharing
        const hexGroups = new Map();
        groupHexagons.forEach(hex => {
          if (!hexGroups.has(hex.h3_id)) {
            hexGroups.set(hex.h3_id, []);
          }
          hexGroups.get(hex.h3_id).push(hex);
        });
        
        // Check each hexagon for sharing
        hexGroups.forEach((claims, hexId) => {
          if (claims.length > 1) {
            // Multiple claims - check if different users
            const uniqueUsers = [...new Set(claims.map(c => c.user_id))];
            if (uniqueUsers.length > 1) {
              // Different users - check timing
              const sortedClaims = claims.sort((a, b) => 
                new Date(b.claimed_at).getTime() - new Date(a.claimed_at).getTime()
              );
              
              const newest = sortedClaims[0];
              const secondNewest = sortedClaims[1];
              
              if (newest && secondNewest) {
                const timeDiff = new Date(newest.claimed_at).getTime() - new Date(secondNewest.claimed_at).getTime();
                const tenMinutes = 10 * 60 * 1000;
                
                if (timeDiff <= tenMinutes) {
                  // Shared within 10 minutes
                  sharedHexagonsMap.set(hexId, uniqueUsers);
                  // console.log('🔍 Shared hexagon:', hexId.slice(-8), 'between users:', uniqueUsers);
                } else {
                  // Conquest - belongs to newest
                  // console.log('🔍 Conquest hexagon:', hexId.slice(-8), 'winner:', newest.user_id.slice(-8));
                }
              }
            }
          }
        });
        
        // Update shared hexagons state
        setSharedHexagons(sharedHexagonsMap);
        
        // FINALLY: Set the cells with colors
        // console.log('🎯 Setting', cellsWithColors.length, 'hexagons with colors');
        setCells(cellsWithColors);
        
      } else {
        console.log('No profiles found for colors');
      }
      
    } catch (e) {
      console.log('Fetch cells error:', e);
    }
  }, [activeGroupId, user?.id]);
  
  useEffect(() => { 
    if (user?.id && activeGroupId) {
      fetchCells(); 
    }
  }, [user?.id, activeGroupId, fetchCells]);
  
    // Map refresh is now handled by the groupMembers useEffect to ensure proper sequencing
  

    
    // REAL-TIME UPDATES: Subscribe to captured_cells changes for instant updates when someone stops
    useEffect(() => {
      if (!activeGroupId || !user?.id) return;


      
              const subscription = supabase
          .channel('captured_cells_changes')
          .on(
            'postgres_changes',
            {
              event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
              schema: 'public',
              table: 'captured_cells'
              // No filter - listen to ALL territory changes to catch conflicts and ownership changes
            },
            (payload) => {
              // Only update when someone has finished claiming (not while walking)
              // This prevents computationally costly updates during active tracking
              if (payload.event === 'INSERT' || payload.event === 'UPDATE') {
                // Check if this hexagon is visible in our current view or affects our leaderboard
                const hexId = payload.new?.h3_id;
                const isVisibleHex = hexId && allHexGrid.has(hexId);
                const affectsCurrentGroup = payload.new?.group_id === activeGroupId;
                const affectsCurrentUser = payload.new?.user_id === user?.id;
                
                if (isVisibleHex || affectsCurrentGroup || affectsCurrentUser) {
                  // Refresh data immediately when relevant changes occur
                  fetchCells();
                  fetchMemberHexCounts();
                }
              }
            }
          )
          .subscribe();

      // Cleanup subscription on unmount or group change
      return () => {
        subscription.unsubscribe();
      };
    }, [activeGroupId, user?.id, fetchCells, fetchMemberHexCounts]);
    
    // Update claimed cells when cells change - replace with database cells (no merging)
  useEffect(() => {
    if (cells && cells.length > 0) {
      // Replace claimed cells with database cells (no merging to avoid duplicates)
        const dbClaimedCells = new Set(cells.map(c => c.h3_id));
      setClaimedCells(dbClaimedCells);
      
      // Ensure all claimed hexagons are in the grid
      const claimedHexIds = cells.map(c => c.h3_id);
      const missingHexIds = claimedHexIds.filter(hexId => !allHexGrid.has(hexId));
      
      if (missingHexIds.length > 0) {
        // Add missing claimed hexagons to the grid
        setAllHexGrid(prevGrid => {
          const newGrid = new Set(prevGrid);
          missingHexIds.forEach(hexId => newGrid.add(hexId));
          return newGrid;
        });
      }
    }
  }, [cells, allHexGrid]);
  
  // Ensure hex counts are fetched whenever group members change
  useEffect(() => {
    if (activeGroupId && groupMembers.length > 0) {
      // Add a delay to ensure state is fully updated and prevent race conditions
      const timeoutId = setTimeout(() => {
        if (activeGroupId && groupMembers.length > 0) {
          fetchMemberHexCounts();
        }
      }, 200);
      
      // Cleanup timeout if component unmounts or dependencies change
      return () => clearTimeout(timeoutId);
    }
  }, [activeGroupId, groupMembers, fetchMemberHexCounts]);
  
  // Periodic refresh as backup to ensure data stays current (every 30 seconds)
  useEffect(() => {
    if (!activeGroupId || !user?.id) return;
    
    const intervalId = setInterval(() => {
      // console.log('🔄 Periodic refresh - updating map and leaderboard...');
      fetchCells();
      fetchMemberHexCounts();
    }, 30000); // 30 seconds
    
    return () => clearInterval(intervalId);
  }, [activeGroupId, user?.id, fetchCells, fetchMemberHexCounts]);
  
  // Refresh data when app comes back to foreground to catch any missed updates
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active' && activeGroupId && user?.id) {
        // Small delay to ensure app is fully active
        setTimeout(() => {
          fetchCells();
          fetchMemberHexCounts();
        }, 1000);
      }
      
      // Handle background location tracking based on app state
      if (nextAppState === 'background' && isTracking && backgroundLocationEnabled) {
        // App going to background - ensure background tracking is active
        // console.log('📱 App going to background - background tracking active');
      } else if (nextAppState === 'active' && isTracking && backgroundLocationEnabled) {
        // App coming to foreground - refresh data and ensure tracking is active
        // console.log('📱 App coming to foreground - refreshing data');
        setTimeout(() => {
          fetchCells();
          fetchMemberHexCounts();
        }, 500);
      }
    };
    
    // Listen for app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => subscription?.remove();
  }, [activeGroupId, user?.id, fetchCells, fetchMemberHexCounts, isTracking, backgroundLocationEnabled]);

  const fetchCellsDebounced = useCallback(() => {
    if (fetchCellsTimer.current) clearTimeout(fetchCellsTimer.current);
    fetchCellsTimer.current = setTimeout(() => { fetchCells(); }, 200);
  }, [fetchCells]);

  /* ----- group members for leaderboard ----- */
  const fetchGroupMembers = useCallback(async () => {
    if (!activeGroupId) { setGroupMembers([]); return; }
    try {
      // First, fetch all group members
      const { data: members, error: membersError } = await supabase
        .from('group_members')
        .select('user_id, role, joined_at')
        .eq('group_id', activeGroupId)
        .order('joined_at', { ascending: true });
      
      if (membersError) {
        setGroupMembers([]);
        return;
      }
      
      if (!members || members.length === 0) {
        setGroupMembers([]);
        return;
      }
      
      // Then, fetch profiles for all members
      const userIds = members.map(m => m.user_id);
      
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, display_name, color')
        .in('id', userIds);
      
      if (profilesError) {
        // Continue with basic member info
      }
      
      // Create a map of user ID to profile data
      const profileMap = new Map();
      if (profiles) {
        profiles.forEach(profile => {
          profileMap.set(profile.id, profile);
        });
      }
      
      // Combine member data with profile data
      const formattedMembers = members.map(member => {
        const profile = profileMap.get(member.user_id);
        return {
          userId: member.user_id,
          role: member.role,
          displayName: profile?.display_name || `Player${member.user_id.slice(-4)}`,
          color: profile?.color || '#6aa2ff'
        };
      });
      
      // Set members directly (no merging needed for group switching)
      setGroupMembers(formattedMembers);
              // console.log('✅ Group members set:', formattedMembers.length, 'members');
      
    } catch (e) {
      console.log('❌ fetchGroupMembers error:', e);
        setGroupMembers([]);
    }
  }, [activeGroupId]);

  // Function to fetch user's groups
  const fetchUserGroups = useCallback(async (isManualRefresh = false) => {
    if (!user?.id) return;
    
    try {
              // console.log('🔍 Fetching user groups...', isManualRefresh ? '(manual refresh)' : '(auto refresh)');
      
      const { data, error } = await supabase
        .from('group_members')
        .select('group_id, groups(name)')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: true });
        
      if (error) {
        console.log('Error fetching user groups:', error);
        return;
      }
      
      const formattedGroups = (data || []).map(r => ({ 
        id: r.group_id, 
        name: r.groups?.name || 'Group' 
      }));
      
              // console.log('🔍 Fetched groups:', formattedGroups.length, 'groups');
      
      // Only update state if this is a manual refresh or if the groups have actually changed
      setGroups(prevGroups => {
        const hasChanged = JSON.stringify(prevGroups) !== JSON.stringify(formattedGroups);
        if (hasChanged || isManualRefresh) {
          // console.log('✅ Updating groups state:', prevGroups.length, '→', formattedGroups.length);
          return formattedGroups;
        } else {
          // console.log('⏭️ Skipping groups state update (no changes)');
          return prevGroups;
        }
      });
    } catch (error) {
      console.log('Error fetching user groups:', error);
    }
  }, [user?.id]);

  /* ----- daily fitness tracking ----- */
  const fetchDailyFitness = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      // First check if we need to reset for a new day
      await resetDailyFitness();
      
      // Use device-local date for today to avoid timezone errors
      const today = new Date().toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('daily_fitness')
        .select('steps, calories_burned')
        .eq('user_id', user.id)
        .eq('date', today)
        .single();
      
      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.log('❌ Error fetching daily fitness:', error);
        return;
      }
      
      if (data) {
        setDailySteps(data.steps || 0);
        setDailyCalories(data.calories_burned || 0);
      } else {
        // Create new entry for today if none exists
        const { error: insertError } = await supabase
          .from('daily_fitness')
          .insert({
            user_id: user.id,
            date: today,
            steps: 0,
            calories_burned: 0
          });
        
        if (insertError) {
          console.log('❌ Error creating daily fitness entry:', insertError);
        } else {
          setDailySteps(0);
          setDailyCalories(0);
        }
      }
    } catch (error) {
      console.log('❌ Error in fetchDailyFitness:', error);
    }
  }, [user?.id, resetDailyFitness]);

  const updateDailyFitness = useCallback(async (newSteps, newCalories) => {
    if (!user?.id) return;
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const { error } = await supabase
        .from('daily_fitness')
        .upsert({
          user_id: user.id,
          date: today,
          steps: newSteps,
          calories_burned: newCalories
        }, { onConflict: 'user_id,date' });
      
      if (error) {
        console.log('❌ Error updating daily fitness:', error);
        return;
      }
      
      setDailySteps(newSteps);
      setDailyCalories(newCalories);
    } catch (error) {
      console.log('❌ Error in updateDailyFitness:', error);
    }
  }, [user?.id]);

  // Reset daily fitness data at midnight based on user's device timezone
  const resetDailyFitness = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      // Use device's timezone safely
      let userTimezone = 'UTC';
      try {
        userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch (tzError) {
        // console.log('⚠️ Could not get timezone, using UTC');
      }
      
      const now = new Date();
      // Create today start date safely without timezone conversion
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      
      // Check if we've crossed midnight
      if (now >= tomorrowStart) {
        console.log(`🕛 Daily reset detected in timezone: ${userTimezone}`);
        
        const { error } = await supabase
          .from('daily_fitness')
          .upsert({
            user_id: user.id,
            date: now.toISOString().split('T')[0], // Use ISO date format
            steps: 0,
            calories_burned: 0
          }, { onConflict: 'user_id,date' });
        
        if (error) {
          console.log('❌ Error resetting daily fitness:', error);
          return;
        }
        
        setDailySteps(0);
        setDailyCalories(0);
        setSessionSteps(0);
        setSessionCalories(0);
        setLastStepCount(0);
        lastStepCountRef.current = 0;
        // console.log('✅ Daily fitness reset completed');
      } else {
        // console.log(`🕐 Current time in timezone: ${userTimezone} - No reset needed`);
      }
    } catch (error) {
      console.log('❌ Error in resetDailyFitness:', error);
    }
  }, [user?.id]);



  // Function to leave a group
  const leaveGroup = useCallback(async (groupId) => {
    try {
      // Get current auth user
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError) throw new Error('Authentication error: ' + authError.message);
      if (!authUser) throw new Error('Not authenticated');

      // Check if user is the owner (owners can delete the entire group)
      const { data: memberships, error: membershipError } = await supabase
        .from('group_members')
        .select('role')
        .eq('group_id', groupId)
        .eq('user_id', authUser.id);

      if (membershipError) {
        throw new Error('Failed to check membership: ' + membershipError.message);
      }
      
      // Check if user is a member and get their role
      if (!memberships || memberships.length === 0) {
        throw new Error('You are not a member of this group');
      }
      
      const membership = memberships[0]; // Get the first (and should be only) membership
      
      if (membership?.role === 'owner') {
        // Owner is leaving - delete the entire group
        try {
          // Delete in proper order to avoid foreign key constraints
          // 1. Delete sessions (they reference group_id)
          const { error: deleteSessionsError } = await supabase
            .from('sessions')
            .delete()
            .eq('group_id', groupId);
          
          if (deleteSessionsError) {
            throw new Error('Failed to delete group sessions: ' + deleteSessionsError.message);
          }
          
          // 2. Delete captured cells (they reference group_id)
          const { error: deleteCellsError } = await supabase
            .from('captured_cells')
            .delete()
            .eq('group_id', groupId);
          
          if (deleteCellsError) {
            throw new Error('Failed to delete group captured cells: ' + deleteCellsError.message);
          }
          
          // 3. Delete group members (they reference group_id)
          const { error: deleteMembersError } = await supabase
            .from('group_members')
            .delete()
            .eq('group_id', groupId);
          
          if (deleteMembersError) {
            throw new Error('Failed to delete group members: ' + deleteMembersError.message);
          }
          
          // 4. Add a small delay to ensure deletions are processed
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // 5. Finally delete the group itself
          const { error: deleteGroupError } = await supabase
            .from('groups')
            .delete()
            .eq('id', groupId);
          
          if (deleteGroupError) {
            // If group deletion fails, try to just remove the user as a fallback
            const { error: fallbackError } = await supabase
              .from('group_members')
              .delete()
              .eq('group_id', groupId)
              .eq('user_id', authUser.id);
            
            if (fallbackError) {
              throw new Error('Failed to delete group and fallback also failed: ' + deleteGroupError.message);
            }
            
            Alert.alert('Group Left', 'Unable to delete the group completely, but you have been removed from it.');
            return; // Exit early since we handled it differently
          }
          
          Alert.alert('Group Deleted', 'You have deleted the group since you were the owner.');
          
        } catch (deletionError) {
          // Try one more fallback approach
          try {
            const { error: finalFallbackError } = await supabase
              .from('group_members')
              .delete()
              .eq('group_id', groupId)
              .eq('user_id', authUser.id);
            
            if (finalFallbackError) {
              throw new Error('All deletion attempts failed: ' + deletionError.message);
            }
            
            Alert.alert('Group Left', 'Unable to delete the group, but you have been removed from it.');
            return; // Exit early
            
          } catch (finalError) {
            throw new Error('Failed to delete group: ' + deletionError.message);
          }
        }
      } else {
        // Regular member - just remove membership
        const { error: deleteError } = await supabase
          .from('group_members')
          .delete()
          .eq('group_id', groupId)
          .eq('user_id', authUser.id);

        if (deleteError) {
          throw new Error('Failed to leave group: ' + deleteError.message);
        }
        
        Alert.alert('Left Group', 'You have successfully left the group.');
      }

      // Immediately update the groups state to remove the left group
      setGroups(prevGroups => {
        const updatedGroups = prevGroups.filter(g => g.id !== groupId);
        return updatedGroups;
      });
      
      // Force a re-render by updating the groups state again after a brief delay
      setTimeout(() => {
        setGroups(currentGroups => {
          if (currentGroups.some(g => g.id === groupId)) {
            return currentGroups.filter(g => g.id !== groupId);
          }
          return currentGroups;
        });
      }, 100);
      
      // Also refresh from database to ensure consistency (but with delay to let state update settle)
      setTimeout(async () => {
        await fetchUserGroups(true); // Manual refresh to ensure consistency
      }, 500);
      
      // Also refresh group members if we're in a group
      if (activeGroupId) {
        await fetchGroupMembers();
        await fetchMemberHexCounts();
      }
      
      // If we were in the group we just left, switch to first available group
      if (activeGroupId === groupId) {
        // Get remaining groups
        const { data: remainingMemberships } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', authUser.id)
          .order('joined_at', { ascending: true });

        if (remainingMemberships && remainingMemberships.length > 0) {
          setActiveGroupId(remainingMemberships[0].group_id);
        } else {
          // No groups left, create a default one
          Alert.alert('No Groups Left', 'You have left all groups. Creating a new default group for you.');
          
          // Create a simple default group
          const { data: newGroup, error: createError } = await supabase
            .from('groups')
            .insert({ 
              name: 'My Crew', 
              created_by: authUser.id 
            })
            .select('id')
            .single();
          
          if (createError) {
            // Silently handle error for production
          } else if (newGroup) {
            // Add user as owner
            const { error: memberError } = await supabase.from('group_members').insert({
              group_id: newGroup.id, 
              user_id: authUser.id, 
              role: 'owner'
            });
            
            if (memberError) {
              // Silently handle error for production
            } else {
              setActiveGroupId(newGroup.id);
            }
          }
        }
      }
    } catch (e) {
      Alert.alert('Error', e.message ?? String(e));
    }
  }, [activeGroupId]);

  // Function to fetch user profile
  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, color, height_cm, weight_kg, age, activity_level')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      if (data) setProfile(data);
      
    } catch (error) {
      // Silently handle error for production
    }
  }, [user?.id]);

  // Function to fetch hex counts for all group members (SIMPLIFIED - matches fetchCells logic)
  const fetchMemberHexCounts = useCallback(async () => {
    if (!activeGroupId) return;
    
    try {
      // console.log('🏆 fetchMemberHexCounts called for group:', activeGroupId.slice(-8));
      
      // SIMPLE: Just get all hexagons in the current group (same as fetchCells)
      const { data: groupHexagons, error: groupError } = await supabase
        .from('captured_cells')
        .select('h3_id, user_id, group_id, claimed_at')
        .eq('group_id', activeGroupId);
      
      if (groupError) {
        console.log('Error fetching hexagons for leaderboard:', groupError);
        return;
      }
      
      if (!groupHexagons || groupHexagons.length === 0) {
        console.log('No hexagons found for leaderboard');
        setMemberHexCounts({});
        setIsLeaderboardLoading(false);
        return;
      }
      
      // console.log('🏆 Found', groupHexagons.length, 'hexagons for leaderboard');
      
      // SIMPLE: For each hexagon, find the most recent claim (same logic as fetchCells)
      const hexagonOwnership = new Map(); // h3_id -> { user_id, claimed_at }
      
      groupHexagons.forEach(hex => {
        const existing = hexagonOwnership.get(hex.h3_id);
        if (!existing || new Date(hex.claimed_at) > new Date(existing.claimed_at)) {
          // This is the most recent claim for this hexagon
          hexagonOwnership.set(hex.h3_id, {
            h3_id: hex.h3_id,
            user_id: hex.user_id,
            group_id: hex.group_id,
            claimed_at: hex.claimed_at
          });
        }
      });
      
      const uniqueHexagons = Array.from(hexagonOwnership.values());
      // console.log('🏆 Unique hexagons for leaderboard:', uniqueHexagons.length);
      
      // CRITICAL: Count hexagons per user, including shared hexagons
      const counts = {};
      
      // First, count all unique hexagons (non-shared)
      uniqueHexagons.forEach(hex => {
        counts[hex.user_id] = (counts[hex.user_id] || 0) + 1;
      });
      
      // SIMPLE: Check for shared hexagons (multiple users within 10 minutes)
      const sharedHexagons = new Map();
      
      // Group by h3_id to find potential sharing
      const hexGroups = new Map();
      groupHexagons.forEach(hex => {
        if (!hexGroups.has(hex.h3_id)) {
          hexGroups.set(hex.h3_id, []);
        }
        hexGroups.get(hex.h3_id).push(hex);
      });
      
      // Check each hexagon for sharing
      hexGroups.forEach((claims, hexId) => {
        if (claims.length > 1) {
          // Multiple claims - check if different users
          const uniqueUsers = [...new Set(claims.map(c => c.user_id))];
          if (uniqueUsers.length > 1) {
            // Different users - check timing
            const sortedClaims = claims.sort((a, b) => 
              new Date(b.claimed_at).getTime() - new Date(a.claimed_at).getTime()
            );
            
            const newest = sortedClaims[0];
            const secondNewest = sortedClaims[1];
            
            if (newest && secondNewest) {
              const timeDiff = new Date(newest.claimed_at).getTime() - new Date(secondNewest.claimed_at).getTime();
              const tenMinutes = 10 * 60 * 1000;
              
              if (timeDiff <= tenMinutes) {
                // Shared within 10 minutes - each user gets 1 point
                sharedHexagons.set(hexId, uniqueUsers);
                // console.log('🏆 Shared hexagon in leaderboard:', hexId.slice(-8), 'between users:', uniqueUsers);
                
                // IMPORTANT: For shared hexagons, each user gets 1 point
                uniqueUsers.forEach(userId => {
                  counts[userId] = (counts[userId] || 0) + 1;
                });
                
                // Remove the single count we added earlier for this hexagon
                // (since we're now giving each user 1 point for sharing)
                const ownerFromUnique = uniqueHexagons.find(h => h.h3_id === hexId);
                if (ownerFromUnique) {
                  counts[ownerFromUnique.user_id] = Math.max(0, (counts[ownerFromUnique.user_id] || 0) - 1);
                }
              } else {
                // Conquest - belongs to newest
                // console.log('🏆 Conquest hexagon in leaderboard:', hexId.slice(-8), 'winner:', newest.user_id.slice(-8));
              }
            }
          }
        }
      });
      
      // console.log('🏆 Final leaderboard counts:', counts);
      // console.log('🏆 Shared hexagons in leaderboard:', sharedHexagons.size);
      
      // Debug: Show detailed counting breakdown
      // if (sharedHexagons.size > 0) {
      //   console.log('🏆 Shared hexagon breakdown:');
      //   sharedHexagons.forEach((users, hexId) => {
      //     console.log(`  Hexagon ${hexId.slice(-8)}: ${users.length} users sharing`);
      //       users.forEach(userId => {
      //         console.log(`    User ${userId.slice(-8)}: ${counts[userId]} total hexagons`);
      //       });
      //   });
      // }
      
      // Update the leaderboard
      setMemberHexCounts(counts);
      
      // Clear loading state
      setIsLeaderboardLoading(false);
      // console.log('✅ Leaderboard updated successfully');
      
      // Final verification: Show what each user should have
      // console.log('🏆 Final verification - User hexagon counts:');
      // Object.entries(counts).forEach(([userId, count]) => {
      //   console.log(`  User ${userId.slice(-8)}: ${count} hexagons`);
      // });
      
    } catch (e) {
      console.log('❌ fetchMemberHexCounts error:', e);
      setIsLeaderboardLoading(false);
    }
  }, [activeGroupId, setIsLeaderboardLoading]);

  // Function to get detailed information about shared hexagons
  const getSharedHexagonsInfo = useCallback(() => {
    if (sharedHexagons.size === 0) return 'No shared hexagons';
    
    const sharedInfo = Array.from(sharedHexagons.entries()).map(([hexId, userIds]) => {
      const hexCell = cells.find(c => c.h3_id === hexId);
      const ownerColor = hexCell?.userColor || '#6aa2ff';
      return `${hexId.slice(-8)}: ${userIds.length} users (${ownerColor})`;
    }).slice(0, 5); // Show first 5 shared hexagons
    
    return `Shared: ${sharedInfo.join(', ')}${sharedHexagons.size > 5 ? '...' : ''}`;
  }, [sharedHexagons, cells]);



  // Function to get all groups the user is part of
  // Note: Territory is now group-specific, so each group maintains separate hexagon ownership
  const getUserGroups = useCallback(async () => {
    if (!user?.id) return [];
    
    try {
      const { data: userGroups, error } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);
      
      if (error) {
        return [];
      }
      
      return userGroups?.map(g => g.group_id) || [];
    } catch (e) {
      return [];
    }
  }, [user?.id]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);
  
  // Consolidated group switching logic to prevent race conditions
  // Track previous activeGroupId to detect actual changes
  const prevActiveGroupId = useRef(activeGroupId);
  
  useEffect(() => {
    // Only run this effect when the activeGroupId actually changes (not on every render)
    if (activeGroupId && activeGroupId !== prevActiveGroupId.current) {
      // INSTANTLY clear previous group's data and show loading
      setGroupMembers([]);
      setMemberHexCounts({});
      setCells([]);
      setClaimedCells(new Set());
      setSharedHexagons(new Map()); // Clear shared hexagons when switching groups
      setIsLeaderboardLoading(true);
      
      // Fetch new group data immediately
      fetchGroupMembers();
      
      // Also regenerate hex grid for the new group location
      // Use a fallback location if no user location is available
      const fallbackLat = 37.7749; // Default latitude (San Francisco)
      const fallbackLon = -122.4194; // Default longitude
              // console.log('🔄 Regenerating hex grid for new group location...');
      generateHexGrid(fallbackLat, fallbackLon, false, conquestMode);
      
      // Debug: Check if hex grid is being generated
      setTimeout(() => {
        // console.log('🔍 Debug: Hex grid size after regeneration:', allHexGrid?.size || 0);
      }, 500);
      
      // Update the ref to track the change
      prevActiveGroupId.current = activeGroupId;
    }
  }, [activeGroupId, fetchGroupMembers, generateHexGrid, conquestMode]);
  
  // Fetch hex counts and map data after group members are loaded (with proper sequencing)
  useEffect(() => {
    if (groupMembers.length > 0) {
      // Small delay to ensure state is fully updated
      setTimeout(async () => {
        // DISABLED: Aggressive cleanup was causing hexagons to disappear randomly
        // console.log('🔄 Group members loaded, running cleanup check...');

        
        // Simply fetch hex counts and map data without destructive cleanup
        fetchMemberHexCounts();
        fetchCells(); // Also fetch map data to show hexagons
      }, 100);
      
      // Safety timeout: clear loading state after 10 seconds if something goes wrong
      const safetyTimeout = setTimeout(() => {
        setIsLeaderboardLoading(false);
      }, 10000);
      
      return () => clearTimeout(safetyTimeout);
    } else if (groupMembers.length === 0) {
      // If no members, clear loading state
      setIsLeaderboardLoading(false);
    }
  }, [groupMembers, fetchMemberHexCounts, fetchCells]);

  /* ----- real-time leaderboard updates ----- */
  useEffect(() => {
    if (!activeGroupId || !user) return;

    
    
    // Subscribe to group_members changes for this group
    const membersSubscription = supabase
      .channel(`group_${activeGroupId}_members`)
      .on('postgres_changes', {
        event: '*', // Listen to all changes (INSERT, UPDATE, DELETE)
        schema: 'public',
        table: 'group_members',
        filter: `group_id=eq.${activeGroupId}`
      }, (payload) => {
        // Show notification for new members
        if (payload.eventType === 'INSERT' && payload.new.user_id !== user.id) {
          // A new user joined (not us)
          setTimeout(() => {
            Alert.alert('👋 New Member!', 'Someone just joined your group!', [{ text: 'Cool!', style: 'default' }]);
          }, 1000); // Delay to avoid interference with join process
        }
        
        // Refresh group members when someone joins/leaves
        fetchGroupMembers();
        
        // Also refresh user groups for header updates
        fetchUserGroups();
      })
      .subscribe();

    // Subscribe to profile changes for real-time color/name updates
    const profilesSubscription = supabase
      .channel(`profiles_updates`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles'
      }, (payload) => {
        // If this is our profile, update local state
        if (payload.new.id === user.id) {
          setProfile({
            display_name: payload.new.display_name,
            color: payload.new.color
          });
        }
        // Refresh group members to get updated colors/names
        fetchGroupMembers();
      })
      .subscribe();

    // Subscribe to groups table changes for real-time group updates
    const groupsSubscription = supabase
      .channel(`groups_updates`)
      .on('postgres_changes', {
        event: '*', // Listen to all changes (INSERT, UPDATE, DELETE)
        schema: 'public',
        table: 'groups'
      }, (payload) => {
              // Refresh user groups for header updates (auto-refresh mode)
      fetchUserGroups(false); // Auto-refresh mode
      })
      .subscribe();

    // Subscribe to captured_cells changes for real-time territory updates
    const territoriesSubscription = supabase
      .channel(`group_${activeGroupId}_territories`)
      .on('postgres_changes', {
        event: 'INSERT', // Only listen to new claims
        schema: 'public',
        table: 'captured_cells',
        filter: `group_id=eq.${activeGroupId}`
      }, (payload) => {
        // Only refresh if someone else claimed territory
        if (payload.new?.user_id !== user.id) {
          // Refresh map to show new territory
          setTimeout(() => {
            fetchCells();
          }, 1000);
        }
      })
      .subscribe();

    // Fallback: Poll for territory updates every 5 minutes
    const fallbackInterval = setInterval(() => {
        fetchCells();
    }, 300000); // Poll every 5 minutes

    return () => {
      membersSubscription.unsubscribe();
      profilesSubscription.unsubscribe();
      groupsSubscription.unsubscribe();
      territoriesSubscription.unsubscribe();
      clearInterval(fallbackInterval);
    };
  }, [activeGroupId, user, fetchGroupMembers, fetchCells]);

  /* ----- auth actions ----- */
  const signUp=async()=>{
    if(!email||!password||!displayName) return Alert.alert('Missing info','Enter username, email, and password.');
    
    try {
      // First create the user account with metadata
      const { data, error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: {
          data: {
            display_name: displayName.trim() // Pass username to trigger
          }
        }
      });
      
      if(error) throw error;
      
      // The database trigger will automatically create the profile with the correct display_name
      // But we'll also try to create it manually as a backup
      if (data.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: data.user.id,
            display_name: displayName.trim(),
            color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
          });
        
        if (profileError) {
          // Continue anyway - profile might be created by trigger
        }
      }
    
    Alert.alert('Welcome 👋','Check your email to confirm your account.');
    } catch (error) {
      Alert.alert('Sign up error', error.message);
    }
  };
  
  const signIn=async()=>{
    if(!email||!password) return Alert.alert('Missing info','Enter email and password.');
    
    try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
      if(error) throw error;
    } catch (error) {
      Alert.alert('Sign in error', error.message);
    }
  };
  const signOut=async()=>{ await supabase.auth.signOut(); setActiveGroupId(null); };

  /* ----- tracking ----- */
  useEffect(()=>{ 
    if(!isTracking) return; 
    const interval = 1000; // 1 second for all platforms
    const id=setInterval(()=>setElapsed(Date.now()-startTime), interval); 
    return ()=>clearInterval(id); 
  },[isTracking,startTime]);

  // Cleanup location interval when component unmounts or tracking stops
  useEffect(() => {
    return () => {
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current);
        locationIntervalRef.current = null;
      }
      
      // Stop background location tracking on unmount
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
      }
    };
  }, []);
  
  // Handle app termination
  useEffect(() => {
    const handleBeforeUnload = () => {
      handleAppTermination();
    };
    
    // Listen for app termination events
    if (Platform.OS === 'web') {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }
    
    return () => {
      if (Platform.OS === 'web') {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    };
  }, [handleAppTermination]);

  // Additional cleanup when tracking state changes
  useEffect(() => {
    if (!isTracking && locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
    }
  }, [isTracking]);

  // Helper function to calculate total distance from points
  const calculateDistance = (points) => {
    if (points.length < 2) return 0;
    
    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      
      // Haversine formula for distance between two points
      const R = 6371000; // Earth's radius in meters
      const lat1 = prev.lat * Math.PI / 180;
      const lat2 = curr.lat * Math.PI / 180;
      const deltaLat = (curr.lat - prev.lat) * Math.PI / 180;
      const deltaLon = (curr.lon - prev.lon) * Math.PI / 180;
      
      const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      
      totalDistance += R * c;
    }
    
    return totalDistance;
  };

  const stopWatching = async () => {
    try {
      // Set tracking state first
      setIsTracking(false);
      setConquestMode(false); // Reset conquest mode when tracking stops
      isTrackingRef.current = false;
      
      // Clear the location interval
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current);
        locationIntervalRef.current = null;
      }
      
      // Clear the step check interval
      if (stepCheckIntervalRef.current) {
        clearInterval(stepCheckIntervalRef.current);
        stepCheckIntervalRef.current = null;
      }
      
      // Stop background location tracking
      await stopBackgroundLocationTracking();
      
      // Process all collected points and claim hexagons in ALL groups the user is part of
      if (points.length > 0 && user?.id) {

        
        try {
          // Get all groups the user is part of
          const userGroups = await getUserGroups();

          
          if (userGroups.length === 0) {

            Alert.alert('No Groups', 'You need to be part of at least one group to claim territory!');
            return;
          }
          
          // Convert all points to unique hexagons
          const hexagonsToProcess = new Set();
          points.forEach(point => {
            try {
              const cell = h3.latLngToCell(point.lat, point.lon, H3_RES);
              hexagonsToProcess.add(cell);
            } catch (e) {
              // Silently handle error for production
            }
          });
          
          const uniqueHexagons = Array.from(hexagonsToProcess);

          
          // Get current time for conflict resolution
          const currentTime = Date.now();
          const tenMinutesAgo = currentTime - (10 * 60 * 1000); // 10 minutes in milliseconds
          
          // Process claims for each group - same hexagons across all groups
          let totalNewClaims = 0;
          let totalSharedClaims = 0;
          let totalAlreadyClaimed = 0;
          
          for (const groupId of userGroups) {

            
            // Claim hexagons in THIS group only (territory is group-specific)
            // Each group maintains its own separate territory
            
            // Check which hexagons are already claimed in this group
            const { data: existingClaims, error: fetchError } = await supabase
              .from('captured_cells')
              .select('h3_id, user_id, claimed_at')
              .eq('group_id', groupId)
              .in('h3_id', uniqueHexagons);
            
            if (fetchError) {
              continue; // Skip this group but continue with others
            }
            
            // Separate hexagons into new claims and conflicts for this group
            const newClaims = [];
            const conflicts = [];
            const alreadyClaimed = new Set();
            const conquestHexagons = []; // Track hexagons that need conquest cleanup
            
            // First pass: categorize hexagons
            uniqueHexagons.forEach(hexId => {
              const existingClaim = existingClaims?.find(claim => claim.h3_id === hexId);
              
              if (!existingClaim) {
                // New hexagon - can claim
                newClaims.push({
                  h3_id: hexId,
                  user_id: user.id,
                  group_id: groupId,
                  claimed_at: new Date(currentTime).toISOString()
                });
              } else if (existingClaim.user_id === user.id) {
                // Already claimed by this user
                alreadyClaimed.add(hexId);
              } else {
                // Check if it's within 10 minutes
                const claimTime = new Date(existingClaim.claimed_at).getTime();
                if (claimTime > tenMinutesAgo) {
                  // Within 10 minutes - both users get it (shared)
                  conflicts.push({
                    h3_id: hexId,
                    user_id: user.id,
                    group_id: groupId,
                    claimed_at: new Date(currentTime).toISOString()
                  });
                } else {
                  // After 10 minutes - new user takes it (conquest)
                  conquestHexagons.push(hexId);
                  newClaims.push({
                    h3_id: hexId,
                    user_id: user.id,
                    group_id: groupId,
                    claimed_at: new Date(currentTime).toISOString()
                  });
                }
              }
            });
            
            // Note: We don't delete old claims here anymore
            // The shared hexagon detection logic now handles this automatically
            // by only marking hexagons as "shared" if they're within 10 minutes
            if (conquestHexagons.length > 0) {
              console.log('🏴 Conquest hexagons:', conquestHexagons.length, '- these will not show as shared');
            }
            
            // Process all claims for this group
            const allClaims = [...newClaims, ...conflicts];
            
            if (allClaims.length > 0) {
              const { error: insertError } = await supabase
                .from('captured_cells')
                .upsert(allClaims);
              
              if (insertError) {
                continue; // Skip this group but continue with others
              }
              
              // Update totals
              totalNewClaims += newClaims.length;
              totalSharedClaims += conflicts.length;
              totalAlreadyClaimed += alreadyClaimed.size;
            }
          }
          
          if (totalNewClaims > 0 || totalSharedClaims > 0) {
            // console.log(`🎉 Total claims across all groups: New: ${totalNewClaims}, Shared: ${totalSharedClaims}, Already yours: ${totalAlreadyClaimed}`);
            
            // Show detailed information about shared hexagons
            let sharedDetails = '';
            if (totalSharedClaims > 0) {
              sharedDetails = `\n🏴 ${totalSharedClaims} hexagons are now shared territory!`;
            }
            
            Alert.alert(
              '🏴 Territory Claimed Across All Groups!', 
              `Successfully claimed territory in ${userGroups.length} groups!\n\n` +
              `Total New: ${totalNewClaims}\n` +
              `Total Shared: ${totalSharedClaims}${sharedDetails}\n` +
              `Already yours: ${totalAlreadyClaimed}`,
              [{ text: 'Awesome!', style: 'default' }]
            );
          } else {
            // console.log('⏭️ No new hexagons to claim in any group');
            // console.log('🔍 Debug: This might indicate a database issue or logic problem');
            Alert.alert('No New Territory', 'All hexagons on this trail were already claimed in all your groups!');
          }
          
          // Refresh the map to show all new claims (for current active group)
          if (activeGroupId) {
            await fetchCells();
            await fetchMemberHexCounts();
          }
          
          // Also refresh all groups to show updated territory states
          
                // Force refresh with delay to ensure DB is updated
      setTimeout(async () => {
        await fetchGroupMembers();
        if (activeGroupId) {
          // console.log('🔄 Delayed refresh after stop - ensuring colors are displayed...');
          await fetchCells();
          await fetchMemberHexCounts();
        }
      }, 1000);
      
      // IMMEDIATE refresh to show colors right away
      if (activeGroupId) {
        // console.log('🔄 Immediate refresh after stop - showing colors now...');
        setTimeout(async () => {
          await fetchCells();
          await fetchMemberHexCounts(); // Also refresh leaderboard immediately
        }, 100); // Small delay to ensure DB transaction is complete
      }
          
        } catch (processingError) {
          Alert.alert('Error', 'Failed to process hexagons: ' + processingError.message);
        }
      }
      
      // Clear local claimed hexes (they're now saved to database)
      setLocalClaimedHexes(new Set());
      
      // Stop pedometer tracking
      if (pedometerSubscription) {
        pedometerSubscription.remove();
        setPedometerSubscription(null);
                  // console.log('👟 Pedometer tracking stopped');
      }
      
      // Calculate and log session stats
      const endTime = Date.now();
      const duration = endTime - startTime;
      const distance = calculateDistance(points);
      const avgSpeed = distance / (duration / 1000); // m/s
      const calories = Math.round(distance * 0.1); // Rough estimate
      
      // Save session to database
      if (activeGroupId && user?.id && points.length > 0) {
        try {
          const { error } = await supabase
            .from('sessions')
            .insert({
              group_id: activeGroupId,
              user_id: user.id,
              started_at: new Date(startTime).toISOString(),
              ended_at: new Date(endTime).toISOString(),
              distance: Math.round(distance),
              duration: Math.round(duration / 1000),
              calories: calories
            });
          
          if (error) {
            // Silently handle error for production
          }
        } catch (sessionError) {
          // Silently handle error for production
        }
      }
      
      // Reset state
      setElapsed(0);
      setStartTime(0);
      
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
    } catch (e) {
      Alert.alert('Error', 'Failed to stop tracking: ' + e.message);
    }
  };

  const startWatching = async () => {
    try {
      setIsTracking(true);
      isTrackingRef.current = true;
      setStartTime(Date.now());
      setElapsed(0);
      
      // console.log('🚀 Starting territory tracking...');
      
      // Check if we already have location permission
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        // console.log('🔐 Requesting foreground location permission...');
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        if (newStatus !== 'granted') {
          Alert.alert(
            'Location Permission Required', 
            'This app needs location access to track your territory. Please enable location permissions in Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() }
            ]
          );
          setIsTracking(false);
          isTrackingRef.current = false;
        return;
        }
      }
      
              // console.log('✅ Foreground permission granted, requesting background...');
      
      // Request background location permission if not already granted
      await requestBackgroundLocationPermission();
      
      // Start background location tracking
      await startBackgroundLocationTracking();
      
      // On iOS, request background permission after tracking starts
      if (Platform.OS === 'ios' && !backgroundLocationEnabled) {
                  // console.log('🍎 iOS: Requesting background permission now that tracking has started...');
        setTimeout(async () => {
          try {
            const { status: backgroundStatus } = await Location.getBackgroundPermissionsAsync();
            if (backgroundStatus !== 'granted') {
              const { status: newBackgroundStatus } = await Location.requestBackgroundPermissionsAsync();
              if (newBackgroundStatus === 'granted') {
                // console.log('✅ iOS background permission granted!');
                setBackgroundLocationEnabled(true);
                await startBackgroundLocationTracking();
              } else {
                // console.log('⚠️ iOS background permission denied');
              }
            }
          } catch (error) {
            // console.log('❌ iOS background permission request failed:', error.message);
          }
        }, 2000); // Wait 2 seconds after tracking starts
      }
      
      // Start pedometer tracking for steps and calories
      if (pedometerAvailable) {
        try {
          // Reset session counters
          setSessionSteps(0);
          setSessionCalories(0);
          setLastStepCount(0);
          
          // Load today's existing steps from database to continue counting
          try {
            const today = new Date().toISOString().split('T')[0];
            const { data: existingData } = await supabase
              .from('daily_fitness')
              .select('steps, calories_burned')
              .eq('user_id', user?.id)
              .eq('date', today)
              .single();
            
            if (existingData && existingData.steps > 0) {
              // console.log('👟 Loading existing steps for today:', existingData.steps);
              setDailySteps(existingData.steps);
              setDailyCalories(existingData.calories_burned || 0);
              setLastStepCount(existingData.steps);
              lastStepCountRef.current = existingData.steps;
                        // Set a flag to indicate we're continuing from existing steps
          // console.log('👟 Continuing from existing steps, will wait for pedometer baseline');
            } else {
                              // console.log('👟 Starting fresh step count from 0');
              setDailySteps(0);
              setLastStepCount(0);
              lastStepCountRef.current = 0;
            }
          } catch (error) {
            // console.log('👟 Could not load existing steps, starting fresh:', error.message);
            setDailySteps(0);
            setLastStepCount(0);
            lastStepCountRef.current = 0;
          }
          
          // Start pedometer subscription with more robust error handling
          const subscription = Pedometer.watchStepCount((result) => {
            // console.log('👟 Pedometer update received:', result);
            if (isTrackingRef.current && result && result.steps !== null && result.steps !== undefined) {
              const currentSteps = result.steps;
              const previousSteps = lastStepCountRef.current || 0;
              const newSteps = currentSteps - previousSteps;
              
              // Handle step counting logic
              if (previousSteps === 0) {
                // First time starting - just set the initial values without counting as new steps
                // console.log('👟 Initial pedometer reading:', currentSteps, '- setting baseline');
                setDailySteps(currentSteps);
                setLastStepCount(currentSteps);
                lastStepCountRef.current = currentSteps;
              } else if (newSteps > 0) {
                // New steps detected - use the actual pedometer total
                // console.log('👟 New steps detected:', newSteps, 'Total today:', currentSteps);
                
                setSessionSteps(prev => prev + newSteps);
                setDailySteps(currentSteps); // Use actual pedometer total
                
                // Calculate calories based on steps (rough estimate: 1 step = 0.04 calories)
                // Use Math.ceil to ensure small step counts still give calories
                const newCalories = Math.ceil(newSteps * 0.04);
                setSessionCalories(prev => prev + newCalories);
                setDailyCalories(prev => prev + newCalories);
                
                // Update database with the actual pedometer total
                updateDailyFitness(currentSteps, dailyCalories + newCalories);
                
                // console.log('👟 Updated - Session:', sessionSteps + newSteps, 'Daily:', currentSteps, 'New Calories:', newCalories);
                setLastStepCount(currentSteps);
                lastStepCountRef.current = currentSteps;
              } else if (newSteps === 0) {
                // No new steps - just update the reference to current pedometer value
                // console.log('👟 No new steps, updating reference to:', currentSteps);
                setLastStepCount(currentSteps);
                lastStepCountRef.current = currentSteps;
              }
            }
          });
          
          setPedometerSubscription(subscription);
          // console.log('👟 Pedometer tracking started successfully');
        } catch (pedometerError) {
          console.log('⚠️ Pedometer error:', pedometerError.message);
        }
      } else {
        console.log('⚠️ Pedometer not available, using fallback step counting');
      }
      
      // OPTIMIZATION: Set up location interval - collect points every 5 seconds with local caching
      // Android performance: Use longer intervals on Android for better performance
      const locationInterval = 5000; // 5 seconds for all platforms
      
      // Also set up a step count verification interval (every 10 seconds)
      stepCheckIntervalRef.current = setInterval(async () => {
        if (!isTrackingRef.current || !pedometerAvailable) return;
        
        try {
          // Just log current state for debugging - don't try to get steps from date range
          // console.log('👟 Step check interval - current state - Session:', sessionSteps, 'Daily:', dailySteps);
        } catch (stepError) {
          console.log('⚠️ Step check interval error:', stepError.message);
        }
      }, 10000); // Check every 10 seconds
      locationIntervalRef.current = setInterval(async () => {
        if (!isTrackingRef.current) return;
        
        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            maximumAge: 10000,
            timeout: 5000
          });
          
          if (location) {
            const newPoint = {
              lat: location.coords.latitude,
              lon: location.coords.longitude,
              timestamp: Date.now()
            };
            
            // OPTIMIZATION: Batch state updates for better performance
            setPoints(prev => [...prev, newPoint]);
            
            // OPTIMIZATION: Process hexagon locally for immediate visual feedback
            try {
              const cell = h3.latLngToCell(newPoint.lat, newPoint.lon, H3_RES);
              
              // OPTIMIZATION: Use functional update to avoid unnecessary re-renders
              setLocalClaimedHexes(prev => {
                if (!prev.has(cell)) {
                  return new Set([...prev, cell]);
                }
                return prev;
              });
            } catch (hexError) {
              // Skip invalid coordinates silently for performance
            }
            
            // Fallback step counting if pedometer isn't working
            if (!pedometerAvailable || sessionSteps === 0) {
              // Estimate steps based on distance moved (roughly 1 step per 0.5 meters)
              const distanceMoved = points.length > 1 ? 
                haversine(points[points.length - 2], points[points.length - 1]) : 0;
              
              if (distanceMoved > 0.3) { // Only count if moved more than 30cm
                const estimatedSteps = Math.max(1, Math.round(distanceMoved / 0.5));
                setSessionSteps(prev => prev + estimatedSteps);
                
                // For fallback, we need to get the current daily total and add to it
                const currentDailyTotal = dailySteps + estimatedSteps;
                setDailySteps(currentDailyTotal);
                
                const estimatedCalories = Math.round(estimatedSteps * 0.04);
                setSessionCalories(prev => prev + estimatedCalories);
                setDailyCalories(prev => prev + estimatedCalories);
                
                // Update database
                updateDailyFitness(currentDailyTotal, dailyCalories + estimatedCalories);
                
                // console.log('👟 Fallback step counting:', estimatedSteps, 'steps from', distanceMoved.toFixed(2), 'm movement');
              }
            }
            
            // Don't update main claimed cells here - let fetchCells handle it
            // This prevents duplicates between local and database cells
          }
        } catch (error) {
          // Silently handle error for production
        }
      }, locationInterval);
      
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              // console.log('🎉 Territory tracking started successfully!');
      
    } catch (e) {
      console.log('❌ Failed to start tracking:', e.message);
      Alert.alert('Error', 'Failed to start tracking: ' + e.message);
      setIsTracking(false);
      isTrackingRef.current = false;
    }
  };
  
  // Background location tracking functions
  const requestBackgroundLocationPermission = async () => {
    try {
      // console.log('🔐 Requesting location permissions...');
      
      // Check current permission status
      const { status: foregroundStatus } = await Location.getForegroundPermissionsAsync();
              // console.log('📱 Foreground permission status:', foregroundStatus);
      
      if (foregroundStatus !== 'granted') {
        // console.log('🔐 Requesting foreground permission...');
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        if (newStatus !== 'granted') {
          throw new Error('Foreground location permission denied');
        }
        // console.log('✅ Foreground permission granted');
      }
      
      // On iOS, we need to wait for the user to start tracking before requesting background
      // This is because iOS only shows "Always" option after the app has been used
      if (Platform.OS === 'ios') {
                  // console.log('📱 iOS detected - background permission will be requested when tracking starts');
        setBackgroundLocationEnabled(false);
        return;
      }
      
      // Try to request background location permission (Android)
      try {
        const { status: backgroundStatus } = await Location.getBackgroundPermissionsAsync();
        // console.log('📱 Background permission status:', backgroundStatus);
        
        if (backgroundStatus !== 'granted') {
          // console.log('🔐 Requesting background permission...');
          const { status: newBackgroundStatus } = await Location.requestBackgroundPermissionsAsync();
          if (newBackgroundStatus !== 'granted') {
            // console.log('⚠️ Background permission not granted, but foreground tracking will work');
            setBackgroundLocationEnabled(false);
            
            // Show guidance to user
            setTimeout(() => {
              showPermissionGuidance();
            }, 1000);
            
            return;
          }
          // console.log('✅ Background permission granted');
        }
        
        setBackgroundLocationEnabled(true);
        setLocationPermissionStatus('granted');
                  // console.log('🎉 All location permissions granted!');
        
      } catch (backgroundError) {
        // console.log('⚠️ Background permission request failed, using foreground only:', backgroundError.message);
        setBackgroundLocationEnabled(false);
        
        // Show guidance to user
        setTimeout(() => {
          showPermissionGuidance();
        }, 1000);
      }
      
    } catch (error) {
      console.log('❌ Location permission request failed:', error.message);
      setBackgroundLocationEnabled(false);
      
      // Show guidance to user
      setTimeout(() => {
        showPermissionGuidance();
      }, 1000);
    }
  };
  
  const startBackgroundLocationTracking = async () => {
    try {
      if (!backgroundLocationEnabled) {
        // console.log('⚠️ Background location not enabled, using foreground tracking only');
        return; // Skip if background location not enabled
      }
      
      console.log('🚀 Starting background location tracking...');
      
      // Configure background location options
      const locationOptions = {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: Platform.OS === 'android' ? 5000 : 3000, // 5s Android, 3s iOS
        distanceInterval: Platform.OS === 'android' ? 10 : 5, // 10m Android, 5m iOS
        showsBackgroundLocationIndicator: Platform.OS === 'ios', // Blue bar on iOS
        foregroundService: {
          notificationTitle: 'Clash of Trails',
          notificationBody: 'Tracking your territory...',
          notificationColor: '#6aa2ff',
        },
        // Android-specific options
        android: {
          notificationTitle: 'Clash of Trails',
          notificationText: 'Tracking your territory...',
          notificationColor: '#6aa2ff',
          notificationIcon: 'ic_notification',
        }
      };
      
              // console.log('📱 Location options configured:', locationOptions);
      
      // Start background location updates
      locationSubscriptionRef.current = await Location.watchPositionAsync(
        locationOptions,
        (location) => {
          if (isTrackingRef.current && location) {
            console.log('📍 Background location update:', {
              lat: location.coords.latitude.toFixed(6),
              lon: location.coords.longitude.toFixed(6),
              accuracy: location.coords.accuracy?.toFixed(1)
            });
            
            const newPoint = {
              lat: location.coords.latitude,
              lon: location.coords.longitude,
              timestamp: Date.now()
            };
            
            // Update points even when app is in background
            setPoints(prev => [...prev, newPoint]);
            
            // Process hexagon locally
            try {
              const cell = h3.latLngToCell(newPoint.lat, newPoint.lon, H3_RES);
              setLocalClaimedHexes(prev => {
                if (!prev.has(cell)) {
                  return new Set([...prev, cell]);
                }
                return prev;
              });
            } catch (hexError) {
              // Skip invalid coordinates silently
            }
            
            // Fitness tracking is now handled by pedometer
          }
        }
      );
      
              // console.log('✅ Background location tracking started successfully!');
      
    } catch (error) {
              // console.log('❌ Background location tracking failed, falling back to foreground only:', error.message);
      setBackgroundLocationEnabled(false);
      
      // Show user-friendly message
      Alert.alert(
        'Background Tracking Unavailable',
        'Background location tracking is not available on this device. Territory tracking will continue while the app is open.',
        [{ text: 'OK', style: 'default' }]
      );
    }
  };
  
  const stopBackgroundLocationTracking = async () => {
    try {
      if (locationSubscriptionRef.current) {
        await locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
      
      setBackgroundLocationEnabled(false);
      
    } catch (error) {
      console.log('Failed to stop background location tracking:', error.message);
    }
  };
  
  // Handle app termination to ensure tracking stops
  const handleAppTermination = useCallback(async () => {
    if (isTracking) {
      console.log('🚨 App terminating - stopping tracking and uploading pending data');
      
      // Stop background tracking
      await stopBackgroundLocationTracking();
      
      // Clear intervals
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current);
        locationIntervalRef.current = null;
      }
      
      // Upload any pending data if possible
      if (points.length > 0 && user?.id) {
        try {
          // Quick upload of current points before app closes
          await uploadPendingData();
        } catch (error) {
          console.log('Failed to upload pending data on termination:', error.message);
        }
      }
    }
  }, [isTracking, points.length, user?.id]);
  
  // Upload pending data function
  const uploadPendingData = async () => {
    if (!points.length || !user?.id || !activeGroupId) return;
    
    try {
      // Convert points to hexagons
      const hexagonsToProcess = new Set();
      points.forEach(point => {
        try {
          const cell = h3.latLngToCell(point.lat, point.lon, H3_RES);
          hexagonsToProcess.add(cell);
    } catch (e) {
          // Skip invalid coordinates
        }
      });
      
      const uniqueHexagons = Array.from(hexagonsToProcess);
      
      if (uniqueHexagons.length === 0) return;
      
      // Quick claim of hexagons
      const claims = uniqueHexagons.map(hexId => ({
        h3_id: hexId,
        user_id: user.id,
        group_id: activeGroupId,
        claimed_at: new Date().toISOString()
      }));
      
      // Upload to database
      const { error } = await supabase
        .from('captured_cells')
        .upsert(claims);
      
      if (!error) {
        // console.log('✅ Pending data uploaded successfully');
      }
      
    } catch (error) {
      console.log('Failed to upload pending data:', error.message);
    }
  };
  
  // Enhanced permission guidance for users
  const showPermissionGuidance = () => {
    if (Platform.OS === 'ios') {
      Alert.alert(
        'Background Location Access',
        'To enable background tracking on iOS:\n\n1. First select "While Using the App"\n2. Then return to the app and start tracking\n3. iOS will ask for "Always" permission\n4. Select "Allow Always" when prompted\n\nThis enables tracking even when the app is minimized!',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() }
        ]
      );
    } else {
      Alert.alert(
        'Background Location Access',
        'To track territory while the app is minimized:\n\n1. Go to Settings > Apps > Clash of Trails > Permissions\n2. Enable "Location" and "Background location"\n3. Return to the app and try again',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() }
        ]
      );
    }
  };

  const secs=Math.floor(elapsed/1000);
  const hh=String(Math.floor(secs/3600)).padStart(2,'0');
  const mm=String(Math.floor((secs%3600)/60)).padStart(2,'0');
  const ss=String(secs%60).padStart(2,'0');

  // Helper function to process polygons - extracted for better performance
  const processPolygons = useCallback((points, baseColor) => {
    // Use Set for O(1) duplicate checking instead of O(n) array operations
    const uniqueHexIds = new Set(); 
    
    // Process points in a single pass for better performance
    const result = [];
    for (const p of points) {
      try {
        const hexId = h3.latLngToCell(p.lat, p.lon, H3_RES);
        if (!uniqueHexIds.has(hexId)) {
          uniqueHexIds.add(hexId);
          
      const coords = polygonFromCell(hexId);
          if (coords) {
            result.push({ 
              id: `live-${hexId}`, 
        coords, 
              fill: rgba(baseColor, 0.7),
              stroke: rgba(baseColor, 1.0),
              strokeWidth: 4, // Consistent stroke width
        type: 'live'
            });
          }
        }
      } catch (e) {
        // Skip invalid coordinates silently for performance
        continue;
      }
    }
    
    return result;
  }, []);
  
  /* ----- live tracking polygons only - OPTIMIZED with local caching ----- */
  const livePolygons = useMemo(()=>{
    if (!isTracking || points.length === 0) return [];
    
    // Performance: Limit points for all platforms if too many
    if (points.length > 50) {
      // Only show last 50 points for better performance
      const limitedPoints = points.slice(-50);
      return processPolygons(limitedPoints, profile?.color || '#6aa2ff');
    }
    
    return processPolygons(points, profile?.color || '#6aa2ff');
  }, [isTracking, points, profile?.color]);

  // All hexagons with proper styling based on status - OPTIMIZED with local caching
  const allHexPolygons = useMemo(() => {
    if (!allHexGrid || allHexGrid.size === 0) {
      return [];
    }
    
    // Early return if no changes detected
    if (allHexGrid.size === 0 && claimedCells.size === 0 && cells.length === 0) {
      return [];
    }
    
    // Performance: Only limit if absolutely necessary
    if (allHexGrid.size > 1000) {
      // Only limit if we have way too many hexagons
      const limitedHexGrid = new Set(Array.from(allHexGrid).slice(-500));
      return processAllHexagons(limitedHexGrid, cells, claimedCells, localClaimedHexes, sharedHexagons, user, profile);
    }
    
    return processAllHexagons(allHexGrid, cells, claimedCells, localClaimedHexes, sharedHexagons, user, profile);
  }, [allHexGrid, cells, claimedCells, localClaimedHexes, sharedHexagons, user, profile, mapConfig.maxPolygons]);
  

    
    

  /* ------------------ SCREENS ------------------ */
  // Move useState hook outside conditional render to fix hooks error
  const [isSignUp, setIsSignUp] = useState(false);
  
  if (!user) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
        <BrandHeader subtitle="Map Your Trails ⚔️" onOpenGroups={()=>{}} onOpenLeaderboard={()=>{}} onOpenProfile={()=>{}} theme={theme} showGroupsButton={false} showLeaderboardButton={false} showProfileButton={false}/>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1}}>
          <ScrollView contentContainerStyle={styles.centerWrap}>
            <Card theme={theme} style={{width:'100%'}}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{isSignUp ? 'Create Account' : 'Welcome Back'}</Text>
              <Text style={[styles.cardHint, { color: theme.sub }]}>
                {isSignUp ? 'Sign up to start claiming territory with your crew.' : 'Sign in to continue your territory conquest.'}
              </Text>
              
              {/* Username field - only for sign up */}
              {isSignUp && (
                <View style={styles.formRow}>
                  <Label theme={theme}>Username</Label>
                  <Input 
                    theme={theme} 
                    value={displayName} 
                    onChangeText={setDisplayName} 
                    placeholder="e.g., NovaRunner"
                  />
                </View>
              )}
              
              <View style={styles.formRow}>
                <Label theme={theme}>Email</Label>
                <Input 
                  theme={theme} 
                  value={email} 
                  onChangeText={setEmail} 
                  keyboardType="email-address" 
                  autoCapitalize="none" 
                  placeholder="you@example.com"
                />
              </View>
              
              <View style={styles.formRow}>
                <Label theme={theme}>Password</Label>
                <Input 
                  theme={theme} 
                  value={password} 
                  onChangeText={setPassword} 
                  secureTextEntry 
                  placeholder="••••••••"
                />
              </View>
              
              <View style={styles.rowGap}>
                <PrimaryButton 
                  theme={theme} 
                  title={isSignUp ? "Sign Up" : "Sign In"} 
                  onPress={isSignUp ? signUp : signIn}
                />
                <GhostButton 
                  theme={theme} 
                  title={isSignUp ? "Already have an account?" : "Create new account"} 
                  onPress={() => setIsSignUp(!isSignUp)}
                />
              </View>
              
              <View style={{ marginTop: 16, flexDirection:'row', alignItems:'center', justifyContent:'center', gap: 10 }}>
                <Text style={{ color: theme.sub }}>Dark mode</Text>
                <Switch value={isDark} onValueChange={setIsDark}/>
              </View>
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Show health setup for new users or existing users updating
  if (showHealthSetup && user) {
    // Check if this is an existing user (has health data) or new user
    const isExistingUser = profile && (profile.height_cm || profile.weight_kg || profile.age);
    
    return (
      <HealthProfileSetup
        theme={theme}
        supabase={supabase}
        user={user}
        isExistingUser={isExistingUser}
        onComplete={() => {
          setShowHealthSetup(false);
          setHasCompletedHealthSetup(true);
          setHasShownHealthSetup(true); // Mark as shown for this session
          // Refresh profile to get new health data
          fetchProfile();
        }}
        onSkip={() => {
          setShowHealthSetup(false);
          setHasCompletedHealthSetup(true);
          setHasShownHealthSetup(true); // Mark as shown for this session
        }}
        onBackToProfile={() => {
          setShowHealthSetup(false);
          // Reopen profile drawer
          setProfileOpen(true);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      {/* Hex Info Modal */}
      {hexInfoModalVisible && selectedHexInfo && (
        <Animated.View 
          style={[
            styles.hexInfoModal,
            {
              opacity: modalOpacity,
              transform: [{ scale: modalScale }]
            }
          ]}
        >
          <Pressable 
            style={styles.hexInfoModalBackground}
            onPress={() => setHexInfoModalVisible(false)}
          />
          <View style={[styles.hexInfoContent, { backgroundColor: theme.card, borderColor: theme.border }]}>
            {/* Header */}
            <View style={styles.hexInfoHeader}>
              <Text style={[styles.hexInfoTitle, { color: theme.text }]}>
                {selectedHexInfo.isShared ? '🏴 Shared Territory' : '📍 Territory Info'}
              </Text>
              <Pressable 
                onPress={() => setHexInfoModalVisible(false)}
                style={styles.hexInfoCloseButton}
              >
                <Text style={styles.hexInfoCloseText}>✕</Text>
              </Pressable>
            </View>
            
            {/* Hex ID */}
            <View style={styles.hexInfoSection}>
              <Text style={[styles.hexInfoLabel, { color: theme.sub }]}>Hex ID</Text>
              <Text style={[styles.hexInfoValue, { color: theme.text }]}>
                {selectedHexInfo.hexId.slice(-8)}...
              </Text>
            </View>
            
            {/* Group */}
            <View style={styles.hexInfoSection}>
              <Text style={[styles.hexInfoLabel, { color: theme.sub }]}>Group</Text>
              <Text style={[styles.hexInfoValue, { color: theme.text }]}>
                {selectedHexInfo.groupName}
              </Text>
            </View>
            
            {/* Owners */}
            <View style={styles.hexInfoSection}>
              <Text style={[styles.hexInfoLabel, { color: theme.sub }]}>
                {selectedHexInfo.isShared ? 'Owners' : 'Owner'}
              </Text>
              {selectedHexInfo.owners.map((owner, index) => (
                <View key={index} style={styles.ownerRow}>
                  <View style={[styles.ownerColor, { backgroundColor: owner.color }]} />
                  <Text style={[styles.ownerName, { color: theme.text }]}>
                    {owner.displayName}
                  </Text>
                  <Text style={[styles.ownerDate, { color: theme.sub }]}>
                    {new Date(owner.capturedAt).toLocaleDateString()}
                  </Text>
                </View>
              ))}
            </View>
            
            {/* Close button */}
            <Pressable 
              onPress={() => setHexInfoModalVisible(false)}
              style={({ pressed }) => [
                styles.hexInfoButton,
                { 
                  backgroundColor: theme.primary,
                  transform: [{ scale: pressed ? 0.95 : 1 }]
                }
              ]}
            >
              <Text style={styles.hexInfoButtonText}>Close</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
      
      <View style={[styles.backgroundPattern, { 
        backgroundColor: theme.isDark ? 'rgba(79, 125, 243, 0.02)' : 'rgba(79, 125, 243, 0.01)'
      }]} />
      <View style={{ paddingTop: Platform.OS === 'android' ? 25 : 0 }}>
        {/* OTA Update Notification */}
        {renderOTAUpdateNotification()}
        
        <BrandHeader 
          subtitle={activeGroupId ? `Group: ${groups.find(g => g.id === activeGroupId)?.name || 'Group'}` : 'Map Your Trails ⚔️'} 
          onOpenGroups={()=>setDrawerOpen(true)} 
          onOpenLeaderboard={async () => {
            setLeaderboardOpen(true);
            // Always refresh data when opening leaderboard to ensure accuracy
            if (activeGroupId) {
              setIsLeaderboardLoading(true);
              // Refresh both group members and hex counts for complete accuracy
              await fetchGroupMembers();
              await fetchMemberHexCounts();
              setIsLeaderboardLoading(false);
            }
          }}
          onOpenProfile={()=>setProfileOpen(true)}
          theme={theme} 
          showGroupsButton={true}
          showLeaderboardButton={!!activeGroupId}
          showProfileButton={true}
          conquestMode={conquestMode}
        />
      </View>
      <View style={{ flex: 1 }}>
        {Platform.OS === 'android' ? (
          initialRegion ? (
                      <WebMapView
            ref={webMapRef}
            style={{ flex: 1 }}
            initialRegion={initialRegion}
            hexagons={[...allHexPolygons, ...livePolygons]}
            onRegionChange={(region) => {
              if (region && region.latitude && region.longitude) {
                // Performance: Consistent grid expansion across platforms
                const now = Date.now();
                if (now - lastGridUpdateRef.current > 1000) { // 1 second throttle for all platforms
                  lastGridUpdateRef.current = now;
                checkAndExpandGrid(region.latitude, region.longitude);
                }
              }
            }}
          />
          ) : (
            <View style={{ flex: 1, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, color: '#666' }}>Loading map...</Text>
            </View>
          )
        ) : (
          initialRegion ? (
        <MapView
          ref={mapRef}
              style={styles.map}
              initialRegion={initialRegion}
              showsUserLocation={true}
              showsMyLocationButton={true}
              showsCompass={true}
              showsScale={true}
              mapType="standard"
              customMapStyle={theme.isDark ? [
                {
                  "elementType": "geometry",
                  "stylers": [{"color": "#242f3e"}]
                },
                {
                  "elementType": "labels.text.fill",
                  "stylers": [{"color": "#746855"}]
                },
                {
                  "elementType": "labels.text.stroke",
                  "stylers": [{"color": "#242f3e"}]
                },
                {
                  "featureType": "administrative.locality",
                  "elementType": "labels.text.fill",
                  "stylers": [{"color": "#d59563"}]
                },
                {
                  "featureType": "poi",
                  "elementType": "labels.text.fill",
                  "stylers": [{"color": "#d59563"}]
                },
                {
                  "featureType": "poi.park",
                  "elementType": "geometry",
                  "stylers": [{"color": "#263c3f"}]
                },
                {
                  "featureType": "poi.park",
                  "elementType": "labels.text.fill",
                  "stylers": [{"color": "#6b9a76"}]
                },
                {
                  "featureType": "road",
                  "elementType": "geometry",
                  "stylers": [{"color": "#38414e"}]
                },
                {
                  "featureType": "road",
                  "elementType": "geometry.stroke",
                  "stylers": [{"color": "#212a37"}]
                },
                {
                  "featureType": "road",
                  "elementType": "labels.text.fill",
                  "stylers": [{"color": "#9ca5b3"}]
                },
                {
                  "featureType": "road.highway",
                  "elementType": "geometry",
                  "stylers": [{"color": "#746855"}]
                },
                {
                  "featureType": "road.highway",
                  "elementType": "geometry.stroke",
                  "stylers": [{"color": "#1f2835"}]
                },
                {
                  "featureType": "road.highway",
                  "elementType": "labels.text.fill",
                  "stylers": [{"color": "#f3d19c"}]
                },
                {
                  "featureType": "transit",
                  "elementType": "geometry",
                  "stylers": [{"color": "#2f3948"}]
                },
                {
                  "featureType": "transit.station",
                  "elementType": "labels.text.fill",
                  "stylers": [{"color": "#d59563"}]
                },
                {
                  "featureType": "water",
                  "elementType": "geometry",
                  "stylers": [{"color": "#17263c"}]
                },
                {
                  "featureType": "water",
                  "elementType": "labels.text.fill",
                  "stylers": [{"color": "#515c6d"}]
                },
                {
                  "featureType": "water",
                  "elementType": "labels.text.stroke",
                  "stylers": [{"color": "#17263c"}]
                }
              ] : []}
              onRegionChangeComplete={(region) => {
                if (region && region.latitude && region.longitude) {
                  checkAndExpandGrid(region.latitude, region.longitude);
                }
              }}
          onMapReady={()=>{
                // Map is ready
              }}
            >
              {/* All hexagons - persistent grid */}
              {allHexPolygons && allHexPolygons.map((p, index) => (
              p && p.coords && p.id && p.fill && p.stroke && typeof p.strokeWidth === 'number' ? (
            <Polygon
                  key={`hex-${p.id}-${index}`}
              coordinates={p.coords}
                  strokeWidth={p.strokeWidth}
                  strokeColor={p.stroke}
                  fillColor={p.fill}
                  zIndex={p.type === 'claimed' ? 4 : p.type === 'owned' ? (p.subtype === 'mine' ? 3 : 2) : 1}
                  onPress={() => handleHexTap(p.id)}
                />
              ) : null
            ))}
            {/* Live tracking preview */}
            {livePolygons && livePolygons.map((p, index) => (
              p && p.coords && p.id && p.fill && p.stroke && typeof p.strokeWidth === 'number' ? (
                <Polygon 
                  key={`live-${p.id}-${index}`} 
                  coordinates={p.coords} 
                  strokeWidth={p.strokeWidth} 
                  strokeColor={p.stroke} 
                  fillColor={p.fill} 
                  zIndex={5}
                  onPress={() => handleHexTap(p.id)}
                />
              ) : null
            ))}
            {/* User location marker */}
            {initialRegion && (
              <Marker
                coordinate={initialRegion}
                title="Your Location"
                description="You are here"
                pinColor={profile?.color || '#6aa2ff'}
              >
                <View style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: profile?.color || '#6aa2ff',
                  borderWidth: 3,
                  borderColor: 'white',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.25,
                  shadowRadius: 3.84,
                  elevation: 5,
                }} />
              </Marker>
            )}
            

        </MapView>
          ) : (
            <View style={{ flex: 1, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, color: '#666' }}>Loading map...</Text>
            </View>
          )
        )}
        
        {/* Persistent Floating Buttons - Always visible with beautiful animations */}
        {initialRegion && (
          <PersistentFloatingButtons 
            theme={theme}
            onOpenGroups={()=>{
              setDrawerOpen(true);
            }}
            onOpenLeaderboard={()=>setLeaderboardOpen(true)}
            onOpenProfile={()=>setProfileOpen(true)}
            showGroupsButton={true}
            showLeaderboardButton={!!activeGroupId}
            showProfileButton={true}
            conquestMode={conquestMode}
            setConquestMode={setConquestMode}
            isTracking={isTracking}
            generateHexGrid={generateHexGrid}
          />
        )}

        <Animated.View style={[styles.bottomSheet, { height: sheetHeight }]}>
          <Card theme={theme} style={{ width:'100%', flex:1, overflow:'hidden' }}>
            {/* Pull-up handle - integrated into the card */}
            <View 
              {...panResponder.panHandlers} 
              style={styles.pullHandle}
            >
              <Animated.View style={[
                styles.pullHandleBar,
                {
                  transform: [{
                    scale: sheetHeight.interpolate({
                      inputRange: [200, 400],
                      outputRange: [1, 1.2]
                    })
                  }]
                }
              ]} />
            </View>
            
            <Pressable onPress={toggleSheet} style={{ alignSelf:'center', paddingVertical: 6 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.sub }}/>
            </Pressable>

            <ScrollView 
              style={{ flex: 1 }} 
              contentContainerStyle={{ paddingBottom: 12 }} 
              nestedScrollEnabled 
              showsVerticalScrollIndicator={false}
            >
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginTop: 4 }}>
                <View>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Live Session</Text>
                  <Text style={[styles.timer, { color: theme.text }]}>{hh}:{mm}:{ss}</Text>
                </View>
                <View style={{ alignItems:'flex-end' }}>
                  <View style={{ flexDirection:'row', alignItems:'center', gap: 8 }}>
                    <Text style={[styles.cardHint, { color: theme.sub }]}>Dark</Text>
                    <Switch value={isDark} onValueChange={setIsDark}/>
                  </View>
                </View>
              </View>

              {!activeGroupId ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.cardHint, { color: theme.sub, marginBottom: 8 }]}>No active group. Open Groups to create or join one.</Text>
                  <PrimaryButton theme={theme} title="Open Groups" onPress={()=>setDrawerOpen(true)} />
                </View>
              ) : (
                <>
                  <View style={[styles.rowGap, { marginTop: 10 }]}>
                    <PrimaryButton theme={theme} title="Start" onPress={startWatching} disabled={isTracking} />
                    <GhostButton theme={theme} title="Stop" onPress={stopWatching} />
                  </View>
                  


                  <View style={styles.statRow}>
                    <View style={[styles.statCard, { backgroundColor: theme.isDark ? '#0f1324' : '#f2f4ff', borderColor: theme.border }]}>
                      <Text style={[styles.statLabel, { color: theme.sub }]}>Trail points</Text>
                      <Text style={[styles.statValue, { color: theme.text }]}>{points.length}</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: theme.isDark ? '#0f1324' : '#f2f4ff', borderColor: theme.border }]}>
                      <Text style={[styles.statLabel, { color: theme.sub }]}>Distance (km)</Text>
                      <Text style={[styles.statValue, { color: theme.text }]}>{(calculateDistance(points)/1000).toFixed(2)}</Text>
                    </View>
                  </View>
                  
                  {/* Daily Fitness Stats - Replaces Total hexs and My hexs */}
                  {user && (
                  <View style={styles.statRow}>
                    <View style={[styles.statCard, { 
                      backgroundColor: theme.isDark ? '#0f1324' : '#f2f4ff', 
                      borderColor: theme.border, 
                      flex: 1,
                      alignItems: 'center',
                      minHeight: 80,
                      justifyContent: 'center'
                    }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 16 }}>👟</Text>
                        <Text style={[styles.statLabel, { color: theme.sub, fontSize: 14, fontWeight: '600' }]}>Steps</Text>
                    </View>
                      <Text style={[styles.statValue, { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 4 }]}>
                        {pedometerAvailable && isTracking ? 
                          (dailySteps + realStepCount).toLocaleString() : 
                          dailySteps.toLocaleString()
                        }
                      </Text>
                      <Text style={[styles.statLabel, { color: theme.sub, fontSize: 10, marginTop: 2 }]}>
                        {pedometerAvailable && isTracking ? 'Live' : 'Today'}
                      </Text>
                      {pedometerAvailable && (
                        <Text style={[styles.statLabel, { color: theme.primary, fontSize: 8, marginTop: 2 }]}>
                          {isTracking ? '📱 Real-time' : '📱 Device sensor'}
                        </Text>
                      )}
                    </View>
                    
                    <View style={[styles.statCard, { 
                      backgroundColor: theme.isDark ? '#0f1324' : '#f2f4ff', 
                      borderColor: theme.border, 
                      flex: 1,
                      alignItems: 'center',
                      minHeight: 80,
                      justifyContent: 'center'
                    }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 16 }}>🔥</Text>
                        <Text style={[styles.statLabel, { color: theme.sub, fontSize: 14, fontWeight: '600' }]}>Calories</Text>
                  </View>
                      <Text style={[styles.statValue, { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 4 }]}>
                        {pedometerAvailable && isTracking ? 
                          (dailyCalories + realCalories).toLocaleString() : 
                          dailyCalories.toLocaleString()
                        }
                      </Text>
                      <Text style={[styles.statLabel, { color: theme.sub, fontSize: 10, marginTop: 2 }]}>
                        {pedometerAvailable && isTracking ? 'Live' : 'Today'}
                      </Text>
                      {pedometerAvailable && (
                        <Text style={[styles.statLabel, { color: theme.primary, fontSize: 8, marginTop: 2 }]}>
                          {isTracking ? '📱 Real-time' : '📱 Device sensor'}
                        </Text>
                      )}
                    </View>
                  </View>
                                    )}
                  
                  {/* Debug pedometer info */}
                  {pedometerAvailable && (
                    <View style={styles.statRow}>
                      <View style={[styles.statCard, { 
                        backgroundColor: theme.isDark ? '#1a1f2e' : '#e8f0ff', 
                        borderColor: theme.primary, 
                        flex: 1,
                        alignItems: 'center',
                        minHeight: 60,
                        justifyContent: 'center'
                      }]}>
                        <Text style={[styles.statLabel, { color: theme.primary, fontSize: 12, fontWeight: '600' }]}>
                          📱 Pedometer Status
                        </Text>
                        <Text style={[styles.statValue, { color: theme.text, fontSize: 14, fontWeight: '600', marginTop: 2 }]}>
                          {isTracking ? 'Active' : 'Ready'}
                        </Text>
                        <Text style={[styles.statLabel, { color: theme.sub, fontSize: 10, marginTop: 2 }]}>
                          Last: {lastStepCount} steps
                        </Text>
                      </View>
                    </View>
                  )}
                  
                  {/* Session stats - only show when tracking */}
                  {isTracking && (
                    <View style={styles.statRow}>
                      <View style={[styles.statCard, { 
                        backgroundColor: theme.isDark ? '#1a1f2e' : '#e8f0ff', 
                        borderColor: theme.primary, 
                        flex: 1,
                        alignItems: 'center',
                        minHeight: 80,
                        justifyContent: 'center'
                      }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 16 }}>🎯</Text>
                          <Text style={[styles.statLabel, { color: theme.primary, fontSize: 14, fontWeight: '600' }]}>Session</Text>
                        </View>
                        <Text style={[styles.statValue, { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 4 }]}>
                          {sessionSteps.toLocaleString()}
                        </Text>
                        <Text style={[styles.statLabel, { color: theme.sub, fontSize: 10, marginTop: 2 }]}>
                          Steps this session
                        </Text>
                      </View>
                      
                      <View style={[styles.statCard, { 
                        backgroundColor: theme.isDark ? '#1a1f2e' : '#e8f0ff', 
                        borderColor: theme.primary, 
                        flex: 1,
                        alignItems: 'center',
                        minHeight: 80,
                        justifyContent: 'center'
                      }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 16 }}>⚡</Text>
                          <Text style={[styles.statLabel, { color: theme.primary, fontSize: 14, fontWeight: '600' }]}>Session</Text>
                        </View>
                        <Text style={[styles.statValue, { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 4 }]}>
                          {sessionCalories.toLocaleString()}
                        </Text>
                        <Text style={[styles.statLabel, { color: theme.sub, fontSize: 10, marginTop: 2 }]}>
                          Calories this session
                        </Text>
                      </View>
                    </View>
                  )}
                  
                  {/* Shared hexagons indicator */}
                  {sharedHexagons.size > 0 && (
                    <View style={styles.statRow}>
                      <View style={[styles.statCard, { 
                        backgroundColor: 'rgba(128, 0, 128, 0.8)', 
                        borderColor: theme.border,
                        flex: 1,
                        alignItems: 'center'
                      }]}>
                        <Text style={[styles.statLabel, { color: '#ffffff', fontWeight: 'bold' }]}>
                          🏴 Shared Territories
                        </Text>
                        <Text style={[styles.statValue, { color: '#ffffff' }]}>
                          {sharedHexagons.size} hexagons
                        </Text>
                        <Text style={[styles.statLabel, { color: '#ffffff', fontSize: 10 }]}>
                          (Purple color on map)
                        </Text>
                      </View>
                    </View>
                  )}
                  

                  


                  {/* Visual status indicator */}
                  {isTracking && (
                    <View style={[styles.statRow, { marginTop: 10 }]}>
                      <View style={[styles.statCard, { 
                        backgroundColor: profile?.color || '#6aa2ff', 
                        borderColor: theme.border,
                        flex: 1,
                        alignItems: 'center',
                        paddingVertical: 12,
                        shadowColor: profile?.color || '#6aa2ff',
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: 0.5,
                        shadowRadius: 10,
                        elevation: 8,
                      }]}>
                        <Text style={[styles.statLabel, { color: 'white', fontWeight: 'bold' }]}>
                          🚶‍♂️ TRACKING ACTIVE
                        </Text>
                        <Text style={[styles.statValue, { color: 'white', fontSize: 16 }]}>
                          Walk around to claim hexagons!
                        </Text>
                        <View style={{ alignItems: 'center' }}>
                          <Text style={[styles.statLabel, { color: 'white', fontSize: 12, marginTop: 4 }]}>
                            Location Interval: {locationIntervalRef.current ? '✅ Active' : '❌ Inactive'}
                      </Text>
                          <Text style={[styles.statLabel, { color: 'white', fontSize: 12 }]}>
                            Last Cell: {lastCellRef.current ? lastCellRef.current.slice(-6) : 'None'}
                            </Text>
                          <Text style={[styles.statLabel, { color: 'white', fontSize: 12 }]}>
                            Location Updates: {locationCounterRef.current}
                            </Text>
                          <Text style={[styles.statLabel, { color: 'white', fontSize: 12 }]}>
                            Points Collected: {points.length}
                          </Text>
                                                    <Text style={[styles.statLabel, { color: 'white', fontSize: 12 }]}>
                            Total Claims: {claimedCells.size}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}













                  <View style={{ flexDirection:'row', gap:12, justifyContent:'space-between', marginTop: 16, paddingHorizontal: 4 }}>
                    <CoolButton 
                      theme={theme} 
                      title="Refresh Map" 
                      type="refresh"
                      onPress={() => {
                      fetchCells();
                        // Also refresh leaderboard to show updated hexagon counts
                        if (activeGroupId) {
                          fetchMemberHexCounts();
                        }
                        // Refresh fitness data
                        fetchDailyFitness();
                      }} 
                    />

                    <CoolButton 
                      theme={theme} 
                      title="Sign Out" 
                      type="signout"
                      onPress={signOut} 
                    />
                  </View>
                </>
              )}
            </ScrollView>
          </Card>
        </Animated.View>
      </View>

      <GroupsDrawer
        visible={drawerOpen}
        onClose={()=>{
          setDrawerOpen(false);
        }}
        activeGroupId={activeGroupId}
        onSelectGroup={(gid)=>{ 
          
          // Simply close drawer and change group - useEffect will handle the rest
          setDrawerOpen(false);
          setActiveGroupId(gid);
        }}
        refreshCells={fetchCells}
        theme={theme}
        userId={user?.id}
        leaveGroup={leaveGroup}
      />

      <LeaderboardDrawer
        visible={leaderboardOpen}
        onClose={()=>setLeaderboardOpen(false)}
        theme={theme}
        groupMembers={groupMembers}
        activeGroupId={activeGroupId}
        memberHexCounts={memberHexCounts}
        isLoading={isLeaderboardLoading}
      />

      <ProfileDrawer
        visible={profileOpen}
        onClose={()=>setProfileOpen(false)}
        theme={theme}
        user={user}
        profile={profile}
        onProfileUpdate={(data) => {
          // Check if this is a signal to open health setup
          if (data && data.openHealthSetup) {
            setShowHealthSetup(true);
            setProfileOpen(false); // Close the profile drawer
            return;
          }
          
          // Normal profile update
          fetchProfile();
          // Also refresh leaderboard to show updated profile immediately
          if (activeGroupId) {
            fetchGroupMembers();
            fetchMemberHexCounts();
          }
        }}

      />
    </SafeAreaView>
  );
}

/* ------------------ PERSISTENT FLOATING BUTTONS ------------------ */
function PersistentFloatingButtons({ theme, onOpenGroups, onOpenLeaderboard, onOpenProfile, showGroupsButton, showLeaderboardButton, showProfileButton, conquestMode, setConquestMode, isTracking, generateHexGrid }) {
  const slideAnim = useRef(new Animated.Value(0)).current;
  const groupsAnim = useRef(new Animated.Value(0)).current;
  const leaderboardAnim = useRef(new Animated.Value(0)).current;
  const profileAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Slide in from top on mount with staggered animation
    Animated.stagger(100, [
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
      Animated.spring(groupsAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
      Animated.spring(leaderboardAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
      Animated.spring(profileAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      })
    ]).start();
  }, []);

  const handlePress = (action, animRef) => {
    // Beautiful press animation
    Animated.sequence([
      Animated.timing(animRef, {
        toValue: 0.8,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(animRef, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
        easing: Easing.elastic(1.2),
      })
    ]).start(() => {
      action();
    });
  };

  return (
    <>
            {/* Groups button - Left Top */}
      {showGroupsButton && (
        <>
          {/* Premium shadow layer */}
          <Animated.View 
            style={[
              styles.premiumShadow,
              {
                top: Platform.select({ ios: 40, android: 60 }),
                left: 20,
                transform: [
                  { 
                    translateY: groupsAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-100, 0]
                    })
                  },
                  { scale: groupsAnim }
                ],
              }
            ]}
          />
          {/* Inner shadow for 3D effect */}
          <Animated.View 
            style={[
              styles.innerShadow,
              {
                top: Platform.select({ ios: 40, android: 60 }),
                left: 20,
                transform: [
                  { 
                    translateY: groupsAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-100, 0]
                    })
                  },
                  { scale: groupsAnim }
                ],
              }
            ]}
          />
          <Animated.View 
            style={[
              styles.persistentButtonLeft,
              { 
                backgroundColor: theme.isDark ? 'rgba(15, 15, 15, 0.95)' : 'rgba(250, 250, 250, 0.95)',
                borderColor: theme.isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.15)',
                transform: [
                  { 
                    translateY: groupsAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-100, 0]
                    })
                  },
                  { scale: groupsAnim }
                ],
              }
            ]}
          >
                          <Pressable 
                onPress={() => {
                  if (conquestMode) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    return;
                  }
                  handlePress(onOpenGroups, groupsAnim);
                }}
                style={[
                  styles.persistentButtonPressable,
                  conquestMode && { opacity: 0.5 }
                ]}
              >
                <Text style={[styles.persistentButtonIcon, { color: conquestMode ? '#666666' : (theme.isDark ? '#ffffff' : '#333333') }]}>☰</Text>
              </Pressable>
          </Animated.View>
          
          {/* Conquest Mode Button - Below Groups Button */}
          {isTracking && (
            <Animated.View 
              style={[
                styles.conquestModeButton,
                { 
                  backgroundColor: conquestMode ? '#ff6b6b' : (theme.isDark ? 'rgba(15, 15, 15, 0.95)' : 'rgba(250, 250, 250, 0.95)'),
                  borderColor: conquestMode ? '#ff6b6b' : (theme.isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.15)'),
                  transform: [
                    { 
                      translateY: groupsAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-100, 0]
                      })
                    },
                    { scale: groupsAnim }
                  ],
                }
              ]}
            >
              <Pressable 
                                  onPress={() => {
                    const newMode = !conquestMode;
                    setConquestMode(newMode);
                    
                    // Regenerate hex grid with conquest mode settings when toggled
                    if (newMode) {
                      // In conquest mode, regenerate grid with much larger coverage
                      const fallbackLat = 37.7749; // Default latitude
                      const fallbackLon = -122.4194; // Default longitude
                      generateHexGrid(fallbackLat, fallbackLon, false, true);
                    } else {
                      // Back to normal mode, regenerate grid with normal coverage
                      const fallbackLat = 37.7749; // Default latitude
                      const fallbackLon = -122.4194; // Default longitude
                      generateHexGrid(fallbackLat, fallbackLon, false, false);
                    }
                    
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  }}
                style={styles.persistentButtonPressable}
              >
                <Text style={[styles.persistentButtonIcon, { color: conquestMode ? '#ffffff' : (theme.isDark ? '#ffffff' : '#333333') }]}>
                  {conquestMode ? '🎯' : '⚔️'}
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </>
      )}

      {/* Leaderboard button - Right Top */}
      {showLeaderboardButton && (
        <Animated.View 
                      style={[
              styles.persistentButtonRightTop,
              { 
                backgroundColor: theme.isDark ? 'rgba(20, 20, 20, 0.85)' : 'rgba(255, 255, 255, 0.85)',
                borderColor: theme.isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                transform: [
                  { 
                    translateY: leaderboardAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-100, 0]
                    })
                  },
                  { scale: leaderboardAnim }
                ],
              }
            ]}
        >
          <Pressable 
            onPress={() => handlePress(onOpenLeaderboard, leaderboardAnim)}
            style={styles.persistentButtonPressable}
          >
            <Text style={[styles.persistentButtonIcon, { color: theme.isDark ? '#ffffff' : '#333333' }]}>🏆</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Profile button - Right Bottom */}
      {showProfileButton && (
        <Animated.View 
                      style={[
              styles.persistentButtonRightBottom,
              { 
                backgroundColor: theme.isDark ? 'rgba(20, 20, 20, 0.85)' : 'rgba(255, 255, 255, 0.85)',
                borderColor: theme.isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                transform: [
                  { 
                    translateY: profileAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-100, 0]
                    })
                  },
                  { scale: profileAnim }
                ],
              }
            ]}
        >
          <Pressable 
            onPress={() => handlePress(onOpenProfile, profileAnim)}
            style={styles.persistentButtonPressable}
          >
            <Text style={[styles.persistentButtonIcon, { color: theme.isDark ? '#ffffff' : '#333333' }]}>👤</Text>
          </Pressable>
        </Animated.View>
      )}
    </>
  );
}

/* ------------------ PROFILE DRAWER ------------------ */
function ProfileDrawer({ visible, onClose, theme, user, profile, onProfileUpdate }) {
  const translateX = useRef(new Animated.Value(400)).current;
  
  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : 400,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [visible]);

  return (
    <Animated.View pointerEvents={visible ? 'auto':'none'} style={[styles.drawerWrapRight, { transform:[{ translateX }] }]}>
      <View style={[styles.drawer, { backgroundColor: theme.card, borderColor: theme.border, paddingTop: Platform.select({ ios: 44, android: 60 }) }]}>
        <View style={[styles.drawerHeader, { borderBottomColor: theme.border, zIndex: 3002, elevation: 3002 }]}>
          <Text style={[styles.drawerTitle, { color: theme.text }]}>👤 Profile Settings</Text>
          <Pressable 
            onPress={onClose} 
            style={[
              styles.drawerClose, 
              { 
                borderColor: '#ff4757'
              }
            ]}
          >
            <Text style={{color: 'white', fontWeight:'900', fontSize: 18}}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <ProfileSection 
            theme={theme} 
            user={user} 
            profile={profile} 
            onProfileUpdate={onProfileUpdate}
            onOpenHealthSetup={() => onProfileUpdate({ openHealthSetup: true })}
    
          />
        </ScrollView>
      </View>
    </Animated.View>
  );
}

/* ------------------ STYLES ------------------ */
const styles = StyleSheet.create({
  screen:{ flex:1, position: 'relative' },
  backgroundPattern: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0
  },
  header:{ paddingHorizontal:20, paddingTop: Platform.select({ ios: 16, android: 40 }), paddingBottom:16, maxWidth: '100%', backgroundColor: 'rgba(255, 255, 255, 0.95)', borderBottomWidth: 1, borderBottomColor: 'rgba(0, 0, 0, 0.08)', shadowColor:'#000', shadowOpacity:0.08, shadowRadius:6, shadowOffset:{width:0,height:2}, elevation: 6, zIndex: 200 },
  brand:{ fontSize:22, fontWeight:'800', letterSpacing:0.5, color: '#0a0a0a' },
  subtitle:{ marginTop:3, fontSize:13, color: '#666666', fontWeight: '500', letterSpacing: 0.2 },
  conquestMode:{ marginTop:6, fontSize:12, fontWeight: 'bold', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 },
  headerButton:{ paddingVertical:12, paddingHorizontal:18, borderRadius:16, borderWidth:1.5, backgroundColor: 'rgba(255, 255, 255, 0.9)', shadowColor:'#000', shadowOpacity:0.1, shadowRadius:5, shadowOffset:{width:0,height:2}, elevation: 4 },
  headerButtonText:{ fontWeight:'800', fontSize: 16, letterSpacing: 0.4 },


  centerWrap:{ padding:24, paddingBottom:40 },
  card:{ borderRadius:20, padding:20, shadowColor:'#000', shadowOpacity:.06, shadowRadius:12, shadowOffset:{width:0,height:6}, borderWidth:1, elevation: 8, position: 'relative', overflow: 'hidden' },
  cardGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(79, 125, 243, 0.02)',
    borderRadius: 20
  },
  cardTitle:{ fontSize:20, fontWeight:'800', letterSpacing: 0.5 },
  cardHint:{ fontSize:13, marginTop:6, lineHeight: 18 },

  label:{ marginBottom:8, fontSize:14, fontWeight: '600' },
  inputContainer: {
    position: 'relative'
  },
  input:{ padding:16, borderRadius:16, borderWidth:1, fontSize: 16, fontWeight: '500' },
  inputGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    zIndex: -1
  },
  formRow:{ marginTop:16 },
  rowGap:{ marginTop:20, gap:12 },

  buttonPrimary:{ 
    paddingVertical:16, 
    borderRadius:18, 
    alignItems:'center', 
    shadowColor:'#000', 
    shadowOpacity: Platform.OS === 'android' ? 0.1 : 0.15, // Reduced shadow for Android
    shadowRadius: Platform.OS === 'android' ? 4 : 6, // Reduced shadow radius for Android
    shadowOffset:{width:0,height:3}, 
    elevation: Platform.OS === 'android' ? 6 : 4, // Higher elevation for Android
    position: 'relative', 
    overflow: 'hidden',
    // Android performance optimizations
    ...(Platform.OS === 'android' && {
      backgroundColor: Platform.OS === 'android' ? '#6aa2ff' : undefined, // Solid background for Android
    })
  },
  buttonPrimaryText:{ color:'#fff', fontWeight:'700', fontSize:16, letterSpacing: 0.3 },
  buttonPrimaryGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 18
  },
  buttonPrimaryText:{ color:'white', fontWeight:'800', fontSize:17, letterSpacing: 0.5 },
  buttonGhost:{ paddingVertical:14, borderRadius:18, alignItems:'center', borderWidth:1, shadowColor:'#000', shadowOpacity:0.12, shadowRadius:6, shadowOffset:{width:0,height:3}, elevation: 4 },
  buttonGhostText:{ fontWeight:'700', fontSize:16, letterSpacing: 0.3 },
  
  // OTA Update Notification Styles
  otaUpdateContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 20,
    right: 20,
    zIndex: 1000,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  otaUpdateContent: {
    padding: 20,
    alignItems: 'center',
  },
  otaUpdateTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
    textAlign: 'center',
  },
  otaUpdateText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
    opacity: 0.9,
  },
  updateProgressContainer: {
    width: '100%',
    marginBottom: 16,
    alignItems: 'center',
  },
  updateProgressBar: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    marginBottom: 8,
    overflow: 'hidden',
  },
  updateProgressFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.3s ease',
  },
  updateProgressText: {
    fontSize: 12,
    fontWeight: '600',
  },
  updateButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    minWidth: 120,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  updateButtonText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  
  coolButton:{ 
    alignItems: 'center', 
    justifyContent: 'center', 
    paddingVertical: 14, 
    paddingHorizontal: 20, 
    borderRadius: 16, 
    shadowColor:'#000', 
    shadowOpacity:0.15, 
    shadowRadius:8, 
    shadowOffset:{width:0,height:4}, 
    elevation: 6,
    minHeight: 48,
    minWidth: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    position: 'relative',
    overflow: 'hidden'
  },
  coolButtonGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16
  },
  coolButtonText:{ 
    color:'white', 
    fontWeight:'700', 
    fontSize:14, 
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  
  // OTA Update Notification Styles
  updateNotification: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 20,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  updateNotificationText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  updateButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  updateButtonText: {
    fontWeight: '600',
    fontSize: 12,
  },

  timer:{ fontSize:32, fontWeight:'900', marginTop:8, letterSpacing:1.5, textAlign: 'center' },

  statRow:{ flexDirection:'row', gap:16, marginTop: 16 },
  statCard:{ flex:1, padding:16, borderRadius:18, borderWidth:1, shadowColor:'#000', shadowOpacity:0.12, shadowRadius:10, shadowOffset:{width:0,height:4}, elevation: 6 },
  statLabel:{ fontSize:13, fontWeight: '600', letterSpacing: 0.3 },
  statValue:{ fontSize:20, fontWeight:'800', marginTop:4, letterSpacing: 0.5 },

  bottomSheet:{ position:'absolute', left:0, right:0, bottom:0, paddingHorizontal:16, paddingBottom:24, zIndex: 150 },
  pullHandle: {
    position: 'absolute',
    top: -20,
    left: '50%',
    transform: [{ translateX: -50 }],
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 160,
    paddingVertical: 20,
    paddingHorizontal: 16,
    width: 150,
    backgroundColor: 'transparent'
  },
  pullHandleBar: {
    width: 50,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'transparent',
    marginBottom: 8
  },
  pullHandleText: {
    fontSize: 12,
    color: '#9aa0bb',
    fontWeight: '500',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.1)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1
  },
  
  // Hex Info Modal Styles
  hexInfoModal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5000,
    elevation: 5000,
  },
  hexInfoModalBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  hexInfoContent: {
    width: '85%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  hexInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  hexInfoTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
    flex: 1,
  },
  hexInfoCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 71, 87, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 71, 87, 0.3)',
  },
  hexInfoCloseText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ff4757',
  },
  hexInfoSection: {
    marginBottom: 16,
  },
  hexInfoLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  hexInfoValue: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(79, 125, 243, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(79, 125, 243, 0.1)',
  },
  ownerColor: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  ownerName: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    letterSpacing: 0.3,
  },
  ownerDate: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.8,
  },
  hexInfoButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  hexInfoButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },


    drawerWrap:{ 
    position:'absolute', 
    top:0, 
    bottom:0, 
    left:0, 
    width:'80%', 
    backgroundColor:'#00000040', 
    zIndex: 3000, 
    elevation: 3000,
    // Android performance optimizations
    ...(Platform.OS === 'android' && {
      backgroundColor: '#00000060', // Slightly more opaque for better performance
      elevation: 3000
    })
  },
  drawerWrapRight:{ 
    position:'absolute', 
    top:0, 
    bottom:0, 
    right:0, 
    width:'80%', 
    backgroundColor:'#00000040', 
    zIndex: 3000, 
    elevation: 3000,
    // Android performance optimizations
    ...(Platform.OS === 'android' && {
      backgroundColor: '#00000060', // Slightly more opaque for better performance
      elevation: 3000
    })
  },
  drawer:{ 
    flex:1, 
    width:'100%', 
    borderRightWidth:1, 
    shadowColor:'#000', 
    shadowOpacity: Platform.OS === 'android' ? 0.2 : 0.3, // Reduced shadow for Android
    shadowRadius: Platform.OS === 'android' ? 15 : 20, // Reduced shadow radius for Android
    shadowOffset:{width:0,height:0}, 
    elevation: 3001, 
    zIndex: 3001,
    // Android performance optimizations
    ...(Platform.OS === 'android' && {
      backgroundColor: Platform.OS === 'android' ? '#ffffff' : undefined, // Solid background for Android
      elevation: 3001
    })
  },
  drawerHeader:{ 
    paddingHorizontal:20, 
    paddingVertical:20, 
    paddingTop: Platform.select({ ios: 20, android: 40 }), 
    borderBottomWidth:1, 
    flexDirection:'row', 
    alignItems:'center', 
    justifyContent:'space-between' 
  },
  drawerTitle:{ fontSize:18, fontWeight:'800', letterSpacing: 0.5 },
  drawerClose:{ 
    paddingVertical: 12, 
    paddingHorizontal: 20, 
    borderRadius: 20, 
    borderWidth: 1.5, 
    borderColor: '#ff4757',
    backgroundColor: '#ff4757',
    shadowColor:'#000', 
    shadowOpacity:0.15, 
    shadowRadius:6, 
    shadowOffset:{width:0,height:3}, 
    elevation: 3003,
    zIndex: 3003,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center'
  },

  groupRow:{ padding:16, borderRadius:16, borderWidth:1, flexDirection:'row', alignItems:'center', justifyContent:'space-between', shadowColor:'#000', shadowOpacity:0.05, shadowRadius:4, shadowOffset:{width:0,height:2}, elevation: 3 },
  groupName:{ fontWeight:'700', fontSize: 15, letterSpacing: 0.3 },

  memberRow:{ padding:16, borderRadius:16, borderWidth:1, flexDirection:'row', alignItems:'center', justifyContent:'space-between', shadowColor:'#000', shadowOpacity:0.05, shadowRadius:4, shadowOffset:{width:0,height:2}, elevation: 3 },
  memberName:{ fontWeight:'600', fontSize: 15, letterSpacing: 0.3 },

  sectionDivider:{ height:1, marginVertical:16, opacity: 0.6 },
  sectionTitle:{ fontWeight:'700', fontSize:16, letterSpacing: 0.3, marginBottom: 4 },
  map:{ flex:1 },
  
  // Floating Action Button Styles
  // Persistent Floating Button Styles - Super Cool Design with Premium Shadows
  persistentButtonLeft:{ 
    position:'absolute', 
    top: Platform.select({ ios: 40, android: 60 }), 
    left: 20, 
    width: 56, 
    height: 56, 
    borderRadius: 28, 
    shadowColor:'#000', 
    shadowOpacity: Platform.OS === 'android' ? 0.3 : 0.5, // Reduced shadow for Android
    shadowRadius: Platform.OS === 'android' ? 6 : 8, // Reduced shadow radius for Android
    shadowOffset:{width:0,height:4}, 
    elevation: Platform.OS === 'android' ? 12 : 10, // Higher elevation for Android
    overflow: 'hidden', 
    borderWidth: 2, 
    zIndex: 1000,
    // Android performance optimizations
    ...(Platform.OS === 'android' && {
      backgroundColor: Platform.OS === 'android' ? '#6aa2ff' : undefined, // Solid background for Android
    })
  },
  conquestModeButton:{ position:'absolute', top: Platform.select({ ios: 110, android: 130 }), left: 20, width: 56, height: 56, borderRadius: 28, shadowColor:'#000', shadowOpacity:0.5, shadowRadius:8, shadowOffset:{width:0,height:4}, elevation: 10, overflow: 'hidden', borderWidth: 2, zIndex: 1000 },
  persistentButtonRightTop:{ position:'absolute', top: Platform.select({ ios: 40, android: 60 }), right: 20, width: 56, height: 56, borderRadius: 28, shadowColor:'#000', shadowOpacity:0.5, shadowRadius:8, shadowOffset:{width:0,height:4}, elevation: 10, overflow: 'hidden', borderWidth: 2, zIndex: 100 },
  persistentButtonRightBottom:{ position:'absolute', top: Platform.select({ ios: 110, android: 130 }), right: 20, width: 56, height: 56, borderRadius: 28, shadowColor:'#000', shadowOpacity:0.5, shadowRadius:8, shadowOffset:{width:0,height:4}, elevation: 10, overflow: 'hidden', borderWidth: 2, zIndex: 100 },
  persistentButtonPressable:{ flex: 1, justifyContent:'center', alignItems:'center' },
  persistentButtonIcon:{ fontSize: 24, fontWeight: '700' },
  premiumShadow:{ position:'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: 'transparent', shadowColor:'#000', shadowOpacity:0.6, shadowRadius:12, shadowOffset:{width:0,height:8}, elevation: 12, zIndex: 99 },
  innerShadow:{ position:'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: 'transparent', shadowColor:'#fff', shadowOpacity:0.3, shadowRadius:4, shadowOffset:{width:0,height:-2}, elevation: 8, zIndex: 101 },
  
  // Leave Group Button Styles - Super Cool Design
  leaveButtonContainerBelow:{ 
    position:'relative', 
    marginTop: 8,
    marginBottom: 8,
    alignItems:'center', 
    zIndex: 10,
    width: '100%'
  },
  leaveButton:{ 
    paddingVertical: 12, 
    paddingHorizontal: 20, 
    borderRadius: 20, 
    borderWidth: 1.5, 
    borderColor: '#ff4757',
    backgroundColor: '#ff4757',
    shadowColor:'#000', 
    shadowOpacity:0.2, 
    shadowRadius:8, 
    shadowOffset:{width:0,height:4}, 
    elevation: 8,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center'
  },
  leaveButtonText:{ 
    color:'white', 
    fontWeight:'700', 
    fontSize: 14, 
    letterSpacing: 0.5,
    textAlign: 'center'
  },
  
  // Cleanup Button Styles
  cleanupButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  cleanupButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
  },
});

