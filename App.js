// App.js — Clash of Trails (Expo)
// Groups: direct DB create/join (no RPC). Hex grid always on. Live capture + bulk on stop.

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Alert,
  SafeAreaView,
  Text,
  TextInput,
  View,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Easing,
  Switch,
} from 'react-native';
import MapView, { Polygon, Marker } from 'react-native-maps';
import WebMapView from './WebMapView';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as h3 from 'h3-js';
import { supabase } from './lib/supabase';

/* ------------------ CONFIG ------------------ */
const H3_RES = 9; // bigger hexes for outdoor territory claiming (trail-scale)

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

  // Helper functions for color manipulation
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  
function hexToRgb(hex){
  const h = (hex || '#6aa2ff').replace('#','');
  const ok = h.length === 6 ? h : '6aa2ff';
  return { r: parseInt(ok.slice(0,2),16), g: parseInt(ok.slice(2,4),16), b: parseInt(ok.slice(4,6),16) };
}
function rgba(hex, alpha){ const {r,g,b} = hexToRgb(hex); return `rgba(${r},${g},${b},${clamp(alpha,0,1)})`; }
function polygonFromCell(h3id){
  try{
    const boundary = h3.cellToBoundary(h3id);
    if (!boundary || boundary.length < 3) return null;
    const coords = boundary.map(([lat,lon]) => ({ latitude: lat, longitude: lon }));
    coords.push({ ...coords[0] }); // Close the polygon
    return coords;
  }catch(e){ 
    console.log('polygonFromCell error:', e);
    return null; 
  }
}
function useTheme(isDark){
  return {
    isDark,
    bg: isDark ? '#0b0e1a' : '#f6f7fb',
    card: isDark ? '#161a2b' : '#ffffff',
    border: isDark ? '#1f2338' : '#e7e9f1',
    text: isDark ? '#ffffff' : '#111322',
    sub: isDark ? '#9aa0bb' : '#5b6076',
    primary: '#4f7df3',
    ghostText: isDark ? '#cbd0e6' : '#2b2f44',
    ghostBorder: isDark ? '#3a3f5a' : '#ccd2ea',
    danger: '#e25555',
    headerGrad: isDark ? ['#141a2e','#0f1220'] : ['#e8ecff','#e9ebf7'],
  };
}

/* ------------------ UI ATOMS ------------------ */
const BrandHeader = ({ subtitle, onOpenGroups, onOpenLeaderboard, theme, showGroupsButton, showLeaderboardButton }) => (
  <LinearGradient colors={theme.headerGrad} style={[styles.header, { borderBottomColor: theme.border }]}>
    <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}>
      {showGroupsButton ? (
        <Pressable onPress={onOpenGroups} style={[styles.headerButton, { borderColor: theme.ghostBorder }]}>
          <Text style={[styles.headerButtonText, { color: theme.ghostText }]}>☰ Groups</Text>
        </Pressable>
      ) : <View style={{width:96}}/>}
      <View style={{alignItems:'center', flex:1}}>
        <Text style={[styles.brand, { color: theme.text }]}>Clash of Trails</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: theme.sub }]}>{subtitle}</Text> : null}
      </View>
      {showLeaderboardButton ? (
        <Pressable onPress={onOpenLeaderboard} style={[styles.headerButton, { borderColor: theme.ghostBorder }]}>
          <Text style={[styles.headerButtonText, { color: theme.ghostText }]}>🏆 Board</Text>
        </Pressable>
      ) : <View style={{width:96}} />}
    </View>
  </LinearGradient>
);
const Card = ({ children, style, theme }) => (
  <View style={[styles.card, style, { backgroundColor: theme.card, borderColor: theme.border }]}>{children}</View>
);
const Label = ({ children, theme }) => (
  <Text style={[styles.label, { color: theme.text }]}>{children}</Text>
);
const Input = ({ theme, style, ...rest }) => (
  <TextInput
    placeholderTextColor={theme.sub}
    {...rest}
    style={[
      styles.input,
      style,
      { backgroundColor: theme.isDark ? '#0f1324' : '#f2f4ff', color: theme.text, borderColor: theme.border }
    ]}
  />
);
const PrimaryButton = ({ title, onPress, disabled, theme }) => (
  <Pressable
    onPress={async()=>{ if(disabled) return; await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress?.(); }}
    style={({pressed})=>[
      styles.buttonPrimary,
      { backgroundColor: theme.primary },
      disabled && { opacity:.45 },
      pressed && { transform:[{scale:.98}] },
    ]}>
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
      pressed && { transform:[{scale:.98}] },
    ]}>
    <Text style={[styles.buttonGhostText, { color: danger ? theme.danger : theme.ghostText }]}>{title}</Text>
  </Pressable>
);

/* ------------------ LEADERBOARD DRAWER ------------------ */
function LeaderboardDrawer({ visible, onClose, theme, groupMembers, activeGroupId }) {
  const translateX = useRef(new Animated.Value(400)).current;
  
  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : 400,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [visible]);

  return (
    <Animated.View pointerEvents={visible ? 'auto':'none'} style={[styles.drawerWrapRight, { transform:[{ translateX }] }]}>
      <View style={[styles.drawer, { backgroundColor: theme.card, borderColor: theme.border, paddingTop: Platform.select({ ios: 44, android: 24 }) }]}>
        <View style={[styles.drawerHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.drawerTitle, { color: theme.text }]}>Leaderboard</Text>
          <Pressable onPress={onClose} style={[styles.drawerClose, { borderColor: theme.ghostBorder }]}>
            <Text style={{color: theme.ghostText, fontWeight:'800'}}>Close</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
          {!activeGroupId ? (
            <Text style={[styles.cardHint, { color: theme.sub }]}>No active group selected</Text>
          ) : groupMembers.length === 0 ? (
            <Text style={[styles.cardHint, { color: theme.sub }]}>No members found</Text>
          ) : (
            groupMembers.map((member, index) => (
              <View key={member.userId} style={[
                styles.memberRow,
                { backgroundColor: theme.isDark ? '#0f1324' : '#eef1ff', borderColor: theme.border }
              ]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: member.color
                  }} />
                  <Text style={[styles.memberName, { color: theme.text }]}>
                    {member.displayName}
                  </Text>
                  {member.role === 'owner' && (
                    <Text style={{ color: theme.primary, fontSize: 10, fontWeight: '600' }}>OWNER</Text>
                  )}
                </View>
                <Text style={{ color: theme.sub, fontSize: 12 }}>#{index + 1}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

/* ------------------ GROUPS DRAWER (DIRECT DB) ------------------ */
function GroupsDrawer({ visible, onClose, activeGroupId, onSelectGroup, theme, refreshCells, userId }) {
  const [groups, setGroups] = useState([]);
  const [newName, setNewName] = useState('My Crew');
  const [joinName, setJoinName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const translateX = useRef(new Animated.Value(-400)).current;
  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : -400,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [visible]);

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
  useEffect(()=>{ if(visible) fetchGroups(); }, [visible, fetchGroups]);

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

  const createGroup = async ()=>{
    try{
      setIsLoading(true);
      setError(null);
      
      const name = newName.trim();
      if (!name) return Alert.alert('Missing name','Enter a group name.');
      
      // Get current auth user to ensure we have the right ID
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError) throw new Error('Authentication error: ' + authError.message);
      if (!authUser) throw new Error('Not authenticated');
      
      // Ensure profile exists before creating group
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: authUser.id,
        display_name: `Player${Date.now().toString().slice(-4)}`,
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
      
      if (groupError) throw new Error('Failed to create group: ' + groupError.message);
      
      const gid = groupData?.id;
      if (!gid) throw new Error('No group id returned');

      // Ensure membership (owner)
      const { error: membershipError } = await supabase.from('group_members').insert({
        group_id: gid, 
        user_id: authUser.id, 
        role: 'owner'
      });
      
      if (membershipError) throw new Error('Failed to add membership: ' + membershipError.message);

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

      // Ensure profile exists before joining group
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: authUser.id,
        display_name: `Player${Date.now().toString().slice(-4)}`,
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
      <View style={[styles.drawer, { backgroundColor: theme.card, borderColor: theme.border, paddingTop: Platform.select({ ios: 44, android: 24 }) }]}>
        <View style={[styles.drawerHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.drawerTitle, { color: theme.text }]}>Your Groups</Text>
          <Pressable onPress={onClose} style={[styles.drawerClose, { borderColor: theme.ghostBorder }]}><Text style={{color: theme.ghostText, fontWeight:'800'}}>Close</Text></Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {/* Debug info */}
          <View style={{ padding: 8, backgroundColor: theme.isDark ? '#1a1f2e' : '#f0f2ff', borderRadius: 8, borderWidth: 1, borderColor: theme.border }}>
            <Text style={[styles.sectionTitle, { color: theme.sub, fontSize: 12 }]}>Debug Info</Text>
            <Text style={[styles.cardHint, { color: theme.sub }]}>User ID: {userId || 'None'}</Text>
            <Text style={[styles.cardHint, { color: theme.sub }]}>Active Group: {activeGroupId || 'None'}</Text>
            <Text style={[styles.cardHint, { color: theme.sub }]}>Groups Count: {groups.length}</Text>
            {isLoading && <Text style={[styles.cardHint, { color: theme.primary }]}>Loading...</Text>}
            {error && <Text style={[styles.cardHint, { color: theme.danger }]}>Error: {error}</Text>}
          </View>

          {groups.map(g => (
            <Pressable key={g.id} onPress={()=>afterSelect(g.id)} style={[
              styles.groupRow,
              { backgroundColor: theme.isDark ? '#0f1324' : '#eef1ff', borderColor: activeGroupId===g.id ? theme.primary : theme.border }
            ]}>
              <Text style={[styles.groupName, { color: theme.text }]}>{g.name}</Text>
              {activeGroupId===g.id ? <Text style={{ color: theme.primary, fontWeight:'800' }}>Active</Text> : null}
            </Pressable>
          ))}

          <View style={[styles.sectionDivider, { backgroundColor: theme.border }]}/>

          <Text style={[styles.sectionTitle, { color: theme.text }]}>Create a group</Text>
          <Input theme={theme} value={newName} onChangeText={setNewName}/>
          <PrimaryButton theme={theme} title={isLoading ? "Creating..." : "Create"} onPress={createGroup} disabled={isLoading}/>

          <Text style={[styles.sectionTitle, { color: theme.text, marginTop:12 }]}>Join by name</Text>
          <Input theme={theme} value={joinName} onChangeText={setJoinName} autoCapitalize="none" placeholder="Exact group name"/>
          <GhostButton theme={theme} title={isLoading ? "Joining..." : "Join"} onPress={joinByName} disabled={isLoading}/>
          
          {/* Test buttons */}
          <View style={[styles.sectionDivider, { backgroundColor: theme.border }]}/>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Debug Actions</Text>
          <GhostButton theme={theme} title="Test DB Connection" onPress={async () => {
            try {
              const { data, error } = await supabase.from('groups').select('count').limit(1);
              console.log('DB test result:', { data, error });
              Alert.alert('DB Test', error ? 'Failed: ' + error.message : 'Success!');
            } catch (e) {
              Alert.alert('DB Test', 'Error: ' + e.message);
            }
          }} mild />
          <GhostButton theme={theme} title="Refresh Groups" onPress={fetchGroups} mild />
        </ScrollView>
      </View>
    </Animated.View>
  );
}

/* ------------------ CAPTURE WRITERS ------------------ */
async function captureCells(cells, groupId, userId) {
  if (!cells || cells.length === 0 || !groupId || !userId) {
    console.log('captureCells: Missing required parameters', { cells: cells?.length, groupId, userId });
    return;
  }
  
  try {
    console.log('Capturing cells:', cells.length, 'for group:', groupId, 'user:', userId);
    
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
      console.log('captureCells database error:', error);
      
      // If it's a schema error, try to understand what's wrong
      if (error.code === '42703') {
        console.log('Schema error - checking table structure');
        const { data: columns, error: schemaError } = await supabase
          .rpc('get_table_columns', { table_name: 'captured_cells' });
        
        if (!schemaError && columns) {
          console.log('Table columns:', columns);
        }
      }
      
      throw error;
    }

    console.log('Successfully captured', cells.length, 'cells for group', groupId);
    
  } catch (error) {
    console.log('captureCells error:', error);
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
    console.log('captureTerritoryGlobal wrote', cells.length, 'cells');
  } catch (e) {
    console.log('captureTerritoryGlobal error:', e?.message || String(e));
  }
}

/* ------------------ MAIN APP ------------------ */
export default function App(){
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
  const [groupMembers, setGroupMembers] = useState([]);

  // tracking
  const [isTracking,setIsTracking]=useState(false);
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


  // live capture throttle + debounce
  const lastCellRef = useRef(null);
  const lastCommitAtRef = useRef(0);
  const fetchCellsTimer = useRef(null);
  const lastGridUpdateRef = useRef(0);
  const lastGridExpansionRef = useRef(0);
  const locationIntervalRef = useRef(null); // New ref for setInterval
  const locationCounterRef = useRef(0); // Counter for location updates
  const isTrackingRef = useRef(false); // Ref to track tracking state

  // bottom sheet
  const sheetY = useRef(new Animated.Value(0)).current;
  const toggleSheet = () => {
    const current = typeof sheetY.__getValue === 'function' ? sheetY.__getValue() : 0;
    Animated.timing(sheetY, { toValue: current > 0.5 ? 0 : 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  };
  const sheetHeight = sheetY.interpolate({ inputRange: [0,1], outputRange: [200, 420] });

  /* ----- auth/session bootstrap ----- */
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>setUser(session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e,s)=>{
      setUser(s?.user ?? null);
      if (s?.user) {
        await supabase.rpc('ensure_profile_ready', { p_display_name: displayName || 'Player' });
        const { data } = await supabase.from('profiles').select('display_name,color').eq('id', s.user.id).single();
        if (data) {
          setProfile(data);
          // Set default color if none exists
          if (!data.color) {
            await supabase.from('profiles').update({ color: '#6aa2ff' }).eq('id', s.user.id);
          }
        }
      } else {
        setProfile(null); setActiveGroupId(null);
      }
    });
    return ()=>sub?.subscription?.unsubscribe?.();
  },[]);

  useEffect(()=>{
    if(!user) return;
    (async()=>{
      await supabase.rpc('ensure_profile_ready', { p_display_name: displayName || 'Player' });
      const { data: prof } = await supabase.from('profiles').select('display_name,color').eq('id', user.id).single();
      if (prof) setProfile(prof);
      const { data } = await supabase.from('group_members').select('group_id').eq('user_id', user.id).order('joined_at',{ascending:true}).limit(1);
      if (data?.length) setActiveGroupId(data[0].group_id);
    })();
  },[user]);

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
            generateHexGrid(lastRegion.latitude, lastRegion.longitude, false, true);
            // Schedule expansion shortly after first paint
            setTimeout(() => generateHexGrid(lastRegion.latitude, lastRegion.longitude, true), 900);
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
          generateHexGrid(region.latitude, region.longitude, true);
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



  /* ----- generate and expand hex grid dynamically ----- */
  const generateHexGrid = useCallback((lat, lon, expand = false) => {
    try {
      const center = h3.latLngToCell(lat, lon, H3_RES);
      
      // Generate hexagons around the center - adjusted for bigger hexagons
      const radius = H3_RES >= 10 ? 4 : 8; // Bigger radius for bigger hexagons
      const hexRing = h3.gridDisk(center, radius);
      
      // Limit total hexagons to prevent crashes
      const maxHexes = H3_RES >= 10 ? 80 : 150; // More hexagons for bigger area coverage
      const limitedHexRing = hexRing.slice(0, maxHexes);
      
      if (expand) {
        // When expanding, add to existing grid instead of replacing
        setAllHexGrid(prevGrid => {
          const newHexes = limitedHexRing.filter(h => !prevGrid.has(h));
          
          if (newHexes.length > 0) {
            return new Set([...prevGrid, ...newHexes]);
          }
          return prevGrid;
        });
      } else {
        // Initial generation
        setAllHexGrid(new Set(limitedHexRing));
      }
    } catch (e) {
      console.log('generateHexGrid error:', e);
    }
  }, []);

  /* ----- check if we need to expand hex grid based on current location ----- */
  const checkAndExpandGrid = useCallback((lat, lon) => {
    const now = Date.now();
    // Only check every 10 seconds to avoid excessive expansion
    if (now - lastGridExpansionRef.current < 10000) return;
    
    try {
      const currentCell = h3.latLngToCell(lat, lon, H3_RES);
      
      // Check if current location is in our hex grid
      if (!allHexGrid.has(currentCell)) {
        lastGridExpansionRef.current = now;

        generateHexGrid(lat, lon, true); // expand = true
      }
    } catch (e) {
      console.log('checkAndExpandGrid error:', e);
    }
  }, [allHexGrid, generateHexGrid]);

  /* ----- owned cells for active group ----- */
  const fetchCells = async () => {
    if (!activeGroupId) return;
    
    try {

      
      const { data: cells, error } = await supabase
        .from('captured_cells')
        .select('h3_id, user_id')
        .eq('group_id', activeGroupId);
      
      if (error) {
        if (error.message && error.message.includes('502 Bad Gateway')) {
          console.log('Network error (502 Bad Gateway) - Supabase may be experiencing issues');
        } else {
          console.log('Error fetching cells:', error);
        }
        return;
      }
      
      if (cells) {
        const dbCellIds = cells.map(cell => cell.h3_id);
        setClaimedCells(new Set(dbCellIds));

      }
      
      // Fetch user profiles for colors
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, color')
        .in('id', [...new Set(cells?.map(cell => cell.user_id) || [])]);
      
      if (profileError) {
        if (profileError.message && profileError.message.includes('502 Bad Gateway')) {
          console.log('Network error (502 Bad Gateway) - Supabase may be experiencing issues');
        } else {
          console.log('Error fetching profiles:', profileError);
        }
        return;
      }
      
      if (profiles) {
        const profileMap = new Map(profiles.map(p => [p.id, p.color]));
        const cellsWithColors = cells?.map(cell => ({
          ...cell,
          userColor: profileMap.get(cell.user_id) || '#dd3c3c'
        })) || [];
        
        setCells(cellsWithColors);

      }
      
    } catch (e) {
      console.log('Fetch cells error:', e);
    }
  };
  useEffect(()=>{ fetchCells(); }, [fetchCells]);
  
  // Update claimed cells when cells change - merge with existing claimed cells
  useEffect(() => {
    if (cells && cells.length > 0) {
      setClaimedCells(prevClaimed => {
        const dbClaimedCells = new Set(cells.map(c => c.h3_id));
        // Merge database cells with any newly claimed cells that haven't been saved yet
        const merged = new Set([...prevClaimed, ...dbClaimedCells]);
        return merged;
      });
      
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

  const fetchCellsDebounced = useCallback(() => {
    if (fetchCellsTimer.current) clearTimeout(fetchCellsTimer.current);
    fetchCellsTimer.current = setTimeout(() => { fetchCells(); }, 200);
  }, [fetchCells]);

  /* ----- group members for leaderboard ----- */
  const fetchGroupMembers = useCallback(async () => {
    if (!activeGroupId) { setGroupMembers([]); return; }
    try {
      console.log('🔍 Fetching group members for group:', activeGroupId);
      
      // First, fetch all group members
      const { data: members, error: membersError } = await supabase
        .from('group_members')
        .select('user_id, role, joined_at')
        .eq('group_id', activeGroupId)
        .order('joined_at', { ascending: true });
      
      if (membersError) {
        if (membersError.message && membersError.message.includes('502 Bad Gateway')) {
          console.log('Network error (502 Bad Gateway) - Supabase may be experiencing issues');
        } else {
          console.log('Error fetching group members:', membersError);
        }
        setGroupMembers([]);
        return;
      }
      
      console.log('📊 Found group members:', members);
      
      if (!members || members.length === 0) {
        console.log('❌ No group members found');
        setGroupMembers([]);
        return;
      }
      
      // Then, fetch profiles for all members
      const userIds = members.map(m => m.user_id);
      console.log('👥 Fetching profiles for user IDs:', userIds);
      
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, display_name, color')
        .in('id', userIds);
      
      if (profilesError) {
        console.log('⚠️ Profile fetch error:', profilesError);
        // Continue with basic member info
      }
      
      console.log('🎨 Found profiles:', profiles);
      
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
      
      console.log('✅ Formatted members:', formattedMembers);
      
      // IMPORTANT: Merge with existing members instead of overwriting
      setGroupMembers(prevMembers => {
        const existingIds = new Set(prevMembers.map(m => m.userId));
        const newMembers = formattedMembers.filter(m => !existingIds.has(m.userId));
        
        if (newMembers.length > 0) {
          console.log('🔄 Merging new members:', newMembers);
          return [...prevMembers, ...newMembers];
        } else {
          console.log('🔄 No new members to merge, keeping existing:', prevMembers.length);
          return prevMembers;
        }
      });
      
    } catch (e) {
      console.log('❌ fetchGroupMembers error:', e);
      setGroupMembers([]);
    }
  }, [activeGroupId]);

  useEffect(() => { fetchGroupMembers(); }, [fetchGroupMembers]);
  
  // Also fetch group members when activeGroupId changes
  useEffect(() => {
    if (activeGroupId) {
      fetchGroupMembers();
    }
  }, [activeGroupId, fetchGroupMembers]);

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
      territoriesSubscription.unsubscribe();
      clearInterval(fallbackInterval);
    };
  }, [activeGroupId, user, fetchGroupMembers, fetchCells]);

  /* ----- auth actions ----- */
  const signUp=async()=>{
    if(!email||!password||!displayName) return Alert.alert('Missing info','Enter email, password, and display name.');
    
    const { data, error } = await supabase.auth.signUp({ email, password });
    if(error) return Alert.alert('Sign up error', error.message);
    
    Alert.alert('Welcome 👋','Check your email to confirm your account.');
  };
  const signIn=async()=>{
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) Alert.alert('Sign in error', error.message);
  };
  const signOut=async()=>{ await supabase.auth.signOut(); setActiveGroupId(null); };

  /* ----- tracking ----- */
  useEffect(()=>{ if(!isTracking) return; const id=setInterval(()=>setElapsed(Date.now()-startTime),1000); return ()=>clearInterval(id); },[isTracking,startTime]);

  // Cleanup location interval when component unmounts or tracking stops
  useEffect(() => {
    return () => {
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current);
        locationIntervalRef.current = null;
      }
    };
  }, []);

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
      console.log('🛑 Stopping location tracking...');
      
      // Set tracking state first
      setIsTracking(false);
      isTrackingRef.current = false;
      
      // Clear the location interval
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current);
        locationIntervalRef.current = null;
      }
      
      // Process all collected points and claim hexagons with smart conflict resolution
      if (points.length > 0 && activeGroupId && user?.id) {
        console.log(`🏴 Processing ${points.length} collected points...`);
        
        try {
          // Convert all points to unique hexagons
          const hexagonsToProcess = new Set();
          points.forEach(point => {
            try {
              const cell = h3.latLngToCell(point.lat, point.lon, H3_RES);
              hexagonsToProcess.add(cell);
            } catch (e) {
              console.log('Hex conversion error:', e);
            }
          });
          
          const uniqueHexagons = Array.from(hexagonsToProcess);
          console.log(`🔷 Processing ${uniqueHexagons.length} unique hexagons`);
          
          // Get current time for conflict resolution
          const currentTime = Date.now();
          const tenMinutesAgo = currentTime - (10 * 60 * 1000); // 10 minutes in milliseconds
          
          // Check which hexagons are already claimed and when
          const { data: existingClaims, error: fetchError } = await supabase
            .from('captured_cells')
            .select('h3_id, user_id, claimed_at')
            .eq('group_id', activeGroupId)
            .in('h3_id', uniqueHexagons);
          
          if (fetchError) {
            console.log('❌ Error fetching existing claims:', fetchError);
            throw fetchError;
          }
          
          // Separate hexagons into new claims and conflicts
          const newClaims = [];
          const conflicts = [];
          const alreadyClaimed = new Set();
          
          uniqueHexagons.forEach(hexId => {
            const existingClaim = existingClaims?.find(claim => claim.h3_id === hexId);
            
            if (!existingClaim) {
              // New hexagon - can claim
              newClaims.push({
                h3_id: hexId,
                user_id: user.id,
                group_id: activeGroupId,
                claimed_at: new Date(currentTime).toISOString()
              });
            } else if (existingClaim.user_id === user.id) {
              // Already claimed by this user
              alreadyClaimed.add(hexId);
            } else {
              // Check if it's within 10 minutes
              const claimTime = new Date(existingClaim.claimed_at).getTime();
              if (claimTime > tenMinutesAgo) {
                // Within 10 minutes - both users get it
                conflicts.push({
                  h3_id: hexId,
                  user_id: user.id,
                  group_id: activeGroupId,
                  claimed_at: new Date(currentTime).toISOString()
                });
              } else {
                // After 10 minutes - new user takes it
                newClaims.push({
                  h3_id: hexId,
                  user_id: user.id,
                  group_id: activeGroupId,
                  claimed_at: new Date(currentTime).toISOString()
                });
              }
            }
          });
          
          // Process all claims at once
          const allClaims = [...newClaims, ...conflicts];
          
          if (allClaims.length > 0) {
            console.log(`💾 Saving ${allClaims.length} hexagon claims...`);
            
            const { error: insertError } = await supabase
              .from('captured_cells')
              .upsert(allClaims, {
                onConflict: 'h3_id,group_id',
                ignoreDuplicates: false
              });
            
            if (insertError) {
              console.log('❌ Error saving claims:', insertError);
              throw insertError;
            }
            
            console.log('✅ All hexagon claims saved successfully');
            
            // Show success message
            const totalNew = newClaims.length + conflicts.length;
            Alert.alert(
              '🏴 Territory Claimed!', 
              `Successfully claimed ${totalNew} hexagons!\n\n` +
              `New: ${newClaims.length}\n` +
              `Shared: ${conflicts.length}\n` +
              `Already yours: ${alreadyClaimed.size}`,
              [{ text: 'Awesome!', style: 'default' }]
            );
          } else {
            console.log('⏭️ No new hexagons to claim');
            Alert.alert('No New Territory', 'All hexagons on this trail were already claimed!');
          }
          
          // Refresh the map to show all new claims
          await fetchCells();
          
        } catch (processingError) {
          console.log('❌ Error processing hexagons:', processingError);
          Alert.alert('Error', 'Failed to process hexagons: ' + processingError.message);
        }
      }
      
      // Calculate and log session stats
      const endTime = Date.now();
      const duration = endTime - startTime;
      const distance = calculateDistance(points);
      const avgSpeed = distance / (duration / 1000); // m/s
      const calories = Math.round(distance * 0.1); // Rough estimate
      
      console.log('Session stats:', { duration, distance, avgSpeed, calories });
      
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
            console.log('Session save error:', error);
          } else {
            console.log('Session saved successfully');
          }
        } catch (sessionError) {
          console.log('Session save error:', sessionError);
        }
      }
      
      // Reset state
      setElapsed(0);
      setStartTime(0);
      
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      console.log('✅ Tracking stopped successfully');
      
    } catch (e) {
      console.log('Stop watching error:', e);
      Alert.alert('Error', 'Failed to stop tracking: ' + e.message);
    }
  };

  const startWatching = async () => {
    try {
      console.log('🚀 Starting location tracking...');
      
      setIsTracking(true);
      isTrackingRef.current = true;
      setStartTime(Date.now());
      setElapsed(0);
      
      // Check if we already have location permission
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required');
        return;
      }
      
      // Set up location interval - collect points every 5 seconds
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
            
            setPoints(prev => [...prev, newPoint]);
            
            // Update local claimed cells for immediate visual feedback
            const cell = h3.latLngToCell(newPoint.lat, newPoint.lon, H3_RES);
            setClaimedCells(prev => {
              if (!prev.has(cell)) {
                return new Set([...prev, cell]);
              }
              return prev;
            });
          }
        } catch (error) {
          console.log('Location error:', error.message);
        }
      }, 5000);
      
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      console.log('✅ Tracking started');
      
    } catch (e) {
      console.log('Start watching error:', e);
      Alert.alert('Error', 'Failed to start tracking: ' + e.message);
    }
  };

  const secs=Math.floor(elapsed/1000);
  const hh=String(Math.floor(secs/3600)).padStart(2,'0');
  const mm=String(Math.floor((secs%3600)/60)).padStart(2,'0');
  const ss=String(secs%60).padStart(2,'0');

  /* ----- live tracking polygons only ----- */
  const livePolygons = useMemo(()=>{
    if (!isTracking || points.length === 0) return [];
    const set = new Set(); 
    for (const p of points) set.add(h3.latLngToCell(p.lat, p.lon, H3_RES));
    

    
    return Array.from(set).map((h3id,i)=>{
      const coords = polygonFromCell(h3id);
      if (!coords) return null;
      const base = profile?.color || '#6aa2ff';
      return { 
        id:`live-${i}`, 
        coords, 
        fill: rgba(base, 0.7), // More opaque for live tracking
        stroke: rgba(base, 1.0), // Solid border
        strokeWidth: 4, // Thicker border for live tracking
        type: 'live'
      };
    }).filter(Boolean);
  },[isTracking, profile?.color, points]);

  // All hexagons with proper styling based on status
  const allHexPolygons = useMemo(() => {
    if (!allHexGrid || allHexGrid.size === 0) return [];
    

    
    const result = Array.from(allHexGrid).map(hexId => {
      if (!hexId) return null;
      
      // Generate coordinates for this hex
      const coords = polygonFromCell(hexId);
      if (!coords) return null;
      
      const isClaimed = claimedCells.has(hexId);
      const isOwned = cells.some(c => c.h3_id === hexId);
      const ownerCell = cells.find(c => c.h3_id === hexId);
      const isMine = ownerCell?.is_mine || ownerCell?.user_id === user?.id;
      

      
      // Priority: Claimed > Owned > Unclaimed
      if (isClaimed) {
        // Claimed by current user - make this most prominent
        const base = profile?.color || '#6aa2ff';

        return {
          id: hexId,
          coords: coords,
          fill: rgba(base, 0.6), // More opaque for claimed
          stroke: rgba(base, 1.0), // Solid border for claimed
          strokeWidth: 3, // Thicker border for claimed
          type: 'claimed',
          subtype: 'active'
        };
      } else if (isOwned && isMine) {
        // My territory from database - solid and prominent
        const base = ownerCell?.color || profile?.color || '#6aa2ff';

        return {
          id: hexId,
          coords: coords,
          fill: rgba(base, 0.4),
          stroke: rgba(base, 0.9),
          strokeWidth: 2.5,
          type: 'owned',
          subtype: 'mine',
          owner: ownerCell?.owner_name
        };
      } else if (isOwned && !isMine) {
        // Other player's territory - beautiful transparent overlay
        const base = ownerCell?.color || '#6aa2ff';

        return {
          id: hexId,
          coords: coords,
          fill: rgba(base, 0.15),
          stroke: rgba(base, 0.7),
          strokeWidth: 1.5,
          type: 'owned',
          subtype: 'other',
          owner: ownerCell?.owner_name
        };
      } else {
        // Unclaimed - neutral but visible

        return {
          id: hexId,
          coords: coords,
          fill: theme.isDark ? 'rgba(100, 110, 130, 0.2)' : 'rgba(200, 210, 230, 0.3)', // More visible
          stroke: theme.isDark ? 'rgba(160, 170, 190, 0.8)' : 'rgba(140, 150, 170, 0.8)', // More visible
          strokeWidth: 1.5, // Slightly thicker for visibility
          type: 'unclaimed'
        };
      }
    }).filter(Boolean);
    


    
    return result;
  }, [allHexGrid, claimedCells, cells, profile?.color, theme.isDark, user?.id]);



  /* ------------------ SCREENS ------------------ */
  if (!user) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
        <BrandHeader subtitle="Own the streets with your crew" onOpenGroups={()=>{}} onOpenLeaderboard={()=>{}} theme={theme} showGroupsButton={false} showLeaderboardButton={false}/>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1}}>
          <ScrollView contentContainerStyle={styles.centerWrap}>
            <Card theme={theme} style={{width:'100%'}}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Welcome</Text>
              <Text style={[styles.cardHint, { color: theme.sub }]}>Sign in or create an account to start tracking.</Text>
              <View style={styles.formRow}><Label theme={theme}>Display name</Label><Input theme={theme} value={displayName} onChangeText={setDisplayName} placeholder="e.g., NovaRunner"/></View>
              <View style={styles.formRow}><Label theme={theme}>Email</Label><Input theme={theme} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com"/></View>
              <View style={styles.formRow}><Label theme={theme}>Password</Label><Input theme={theme} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••"/></View>
              <View style={styles.rowGap}><PrimaryButton theme={theme} title="Sign In" onPress={signIn}/><GhostButton theme={theme} title="Sign Up" onPress={signUp}/></View>
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

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={{ paddingTop: Platform.OS === 'android' ? 25 : 0 }}>
        <BrandHeader 
          subtitle={activeGroupId ? `Map · Territories ${profile?.color ? '●' : ''}` : 'Create or join a group'} 
          onOpenGroups={()=>setDrawerOpen(true)} 
          onOpenLeaderboard={()=>setLeaderboardOpen(true)}
          theme={theme} 
          showGroupsButton={true}
          showLeaderboardButton={!!activeGroupId}
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
                checkAndExpandGrid(region.latitude, region.longitude);
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
                console.log('Map ready on', Platform.OS);
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
        
        

        <Animated.View style={[styles.bottomSheet, { height: sheetHeight }]}>
          <Card theme={theme} style={{ width:'100%', flex:1, overflow:'hidden' }}>
            <Pressable onPress={toggleSheet} style={{ alignSelf:'center', paddingVertical: 6 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.sub }}/>
            </Pressable>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
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
                  
                  <View style={styles.statRow}>
                    <View style={[styles.statCard, { backgroundColor: theme.isDark ? '#0f1324' : '#f2f4ff', borderColor: theme.border }]}>
                      <Text style={[styles.statLabel, { color: theme.sub }]}>Total hexs</Text>
                      <Text style={[styles.statValue, { color: theme.text }]}>{allHexGrid.size}</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: theme.isDark ? '#0f1324' : '#f2f4ff', borderColor: theme.border }]}>
                      <Text style={[styles.statLabel, { color: theme.sub }]}>My hexs</Text>
                      <Text style={[styles.statValue, { color: theme.text }]}>{claimedCells.size}</Text>
                    </View>
                  </View>

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
                            Local Claims: {claimedCells.size}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Claimed hexagons preview */}
                  {claimedCells.size > 0 && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={[styles.statLabel, { color: theme.sub, marginBottom: 8 }]}>
                        🏴 Your Claimed Territory ({claimedCells.size} hexagons)
                      </Text>
                      <View style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: 8,
                        paddingHorizontal: 4
                      }}>
                        {Array.from(claimedCells).slice(0, 6).map((hexId, index) => (
                          <View key={index} style={{
                            backgroundColor: profile?.color || '#6aa2ff',
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: 'white'
                          }}>
                            <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
                              {hexId.slice(-4)}
                            </Text>
                          </View>
                        ))}
                        {claimedCells.size > 6 && (
                          <View style={{
                            backgroundColor: theme.sub,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: theme.border
                          }}>
                            <Text style={{ color: theme.text, fontSize: 10 }}>
                              +{claimedCells.size - 6} more
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}

                  {profile?.color && (
                    <View style={styles.statRow}>
                      <View style={[styles.statCard, { backgroundColor: theme.isDark ? '#0f1324' : '#f2f4ff', borderColor: theme.border, flex: 1 }]}>
                        <Text style={[styles.statLabel, { color: theme.sub }]}>My Territory Color</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                          <View style={{
                            width: 24,
                            height: 24,
                            backgroundColor: profile.color,
                            borderRadius: 12,
                            marginRight: 8,
                            borderWidth: 2,
                            borderColor: theme.border
                          }} />
                          <Text style={[styles.statValue, { color: theme.text, fontSize: 14 }]}>
                            {profile.display_name || 'You'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}

                  <View style={{ flexDirection:'row', gap:10, justifyContent:'space-between', marginTop: 8 }}>
                    <GhostButton theme={theme} title="Refresh Map" onPress={fetchCells} mild />
                    <GhostButton theme={theme} title="Check for Updates" onPress={() => {
                      console.log('Manual territory check triggered');
                      fetchCells();
                    }} mild />
                    <GhostButton theme={theme} title="Test Claiming Logic" onPress={async () => {
                      if (!activeGroupId || !user?.id) {
                        Alert.alert('No Group', 'Join a group first to test claiming logic');
                        return;
                      }
                      
                      console.log('🧪 Testing claiming logic...');
                      
                      try {
                        // Get current claimed cells
                        const { data: currentClaims, error } = await supabase
                          .from('captured_cells')
                          .select('h3_id, user_id, claimed_at')
                          .eq('group_id', activeGroupId);
                        
                        if (error) {
                          console.log('❌ Error fetching current claims:', error);
                          return;
                        }
                        
                        console.log(`📊 Current claims in database: ${currentClaims?.length || 0}`);
                        console.log('🔍 Sample claims:', currentClaims?.slice(0, 3));
                        
                        // Test a sample hexagon
                        const testHex = '8d2aa5d6334c43f'; // Use one of your existing hexagons
                        
                        const existingClaim = currentClaims?.find(claim => claim.h3_id === testHex);
                        
                        if (existingClaim) {
                          if (existingClaim.user_id === user.id) {
                            console.log(`✅ Hex ${testHex.slice(-6)} already claimed by you`);
                            Alert.alert('Test Result', `Hex ${testHex.slice(-6)} already claimed by you`);
                          } else {
                            console.log(`⚠️ Hex ${testHex.slice(-6)} claimed by another user`);
                            Alert.alert('Test Result', `Hex ${testHex.slice(-6)} claimed by another user`);
                          }
                        } else {
                          console.log(`🆕 Hex ${testHex.slice(-6)} not claimed yet`);
                          Alert.alert('Test Result', `Hex ${testHex.slice(-6)} not claimed yet`);
                        }
                        
                      } catch (e) {
                        console.log('Test error:', e);
                        Alert.alert('Error', 'Test failed: ' + e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Test Capture" onPress={async () => {
                      if (activeGroupId && user?.id) {
                        console.log('Testing territory capture...');
                        const testCell = h3.latLngToCell(40.7128, -74.0060, H3_RES); // NYC test cell
                        await captureCells([testCell], activeGroupId, user.id);
                        fetchCells();
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Test DB" onPress={async () => {
                      console.log('Testing database connection...');
                      const { data, error } = await supabase
                        .from('captured_cells')
                        .select('h3_id')
                        .limit(1);
                      console.log('DB test result:', { data, error });
                    }} mild />
                    <GhostButton theme={theme} title="Test Hex Claim" onPress={async () => {
                      if (activeGroupId && user?.id) {
                        console.log('🧪 Testing hex claiming logic...');
                        const testCell = h3.latLngToCell(40.7128, -74.0060, H3_RES); // NYC test cell
                        console.log('Test cell:', testCell);
                        
                        // Add to claimed cells
                        setClaimedCells(prev => {
                          const newSet = new Set([...prev, testCell]);
                          console.log('Test: Claimed cells updated:', Array.from(newSet));
                          return newSet;
                        });
                        
                        // Save to database
                        await captureCells([testCell], activeGroupId, user.id);
                        console.log('Test: Hex claimed successfully');
                        fetchCells();
                      } else {
                        console.log('Cannot test - missing group or user');
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Test Location" onPress={async () => {
                      console.log('🧪 Testing location services...');
                      try {
                        const { status } = await Location.requestForegroundPermissionsAsync();
                        console.log('Location permission status:', status);
                        
                        if (status === 'granted') {
                          const location = await Location.getCurrentPositionAsync({
                            accuracy: Location.Accuracy.Balanced,
                            timeout: 5000
                          });
                          console.log('Current location:', location.coords);
                          
                          const cell = h3.latLngToCell(location.coords.latitude, location.coords.longitude, H3_RES);
                          console.log('Current H3 cell:', cell);
                          
                          Alert.alert('Location Test', 
                            `Lat: ${location.coords.latitude.toFixed(6)}\n` +
                            `Lon: ${location.coords.longitude.toFixed(6)}\n` +
                            `H3 Cell: ${cell}`
                          );
                        } else {
                          Alert.alert('Permission Denied', 'Location permission is required for testing');
                        }
                      } catch (e) {
                        console.log('Location test error:', e);
                        Alert.alert('Error', 'Location test failed: ' + e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Test Interval Logic" onPress={async () => {
                      console.log('🧪 Testing location interval logic manually...');
                      
                      if (!isTracking) {
                        Alert.alert('Not Tracking', 'Start tracking first to test interval logic');
                        return;
                      }
                      
                      if (!activeGroupId || !user?.id) {
                        Alert.alert('No Group', 'Join a group first to test interval logic');
                        return;
                      }
                      
                      try {
                        // Simulate what the interval does
                        const location = await Location.getCurrentPositionAsync({
                          accuracy: Location.Accuracy.Balanced,
                          timeout: 5000
                        });
                        
                        const { latitude: lat, longitude: lon } = location.coords;
                        const cell = h3.latLngToCell(lat, lon, H3_RES);
                        
                        console.log('📍 Test location:', lat.toFixed(6), lon.toFixed(6));
                        console.log('🔷 Test H3 cell:', cell);
                        console.log('🔍 Last cell ref:', lastCellRef.current);
                        
                        if (cell !== lastCellRef.current) {
                          console.log('✅ Test: Would claim new hexagon');
                          
                          // Actually claim it for testing
                          setClaimedCells(prev => {
                            const newSet = new Set([...prev, cell]);
                            console.log('Test: Claimed cells updated:', Array.from(newSet));
                            return newSet;
                          });
                          
                          await captureCells([cell], activeGroupId, user.id);
                          lastCellRef.current = cell;
                          
                          Alert.alert('Test Success', `Would claim hexagon ${cell.slice(-6)}`);
                        } else {
                          console.log('⏭️ Test: Same cell, no claim needed');
                          Alert.alert('Test Result', 'Same cell - no new hexagon to claim');
                        }
                        
                      } catch (e) {
                        console.log('Test interval logic error:', e);
                        Alert.alert('Error', 'Test failed: ' + e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Debug Location" onPress={async () => {
                      console.log('=== DEBUG LOCATION ===');
                      console.log('isTracking state:', isTracking);
                      console.log('locationIntervalRef:', !!locationIntervalRef.current);
                      console.log('locationCounterRef:', locationCounterRef.current);
                      console.log('lastCellRef:', lastCellRef.current);
                      console.log('claimedCells:', Array.from(claimedCells));
                      console.log('activeGroupId:', activeGroupId);
                      console.log('user:', user?.id);
                      
                      try {
                        const location = await Location.getCurrentPositionAsync({
                          accuracy: Location.Accuracy.Balanced,
                          timeout: 5000
                        });
                        console.log('Current location:', location.coords);
                        const cell = h3.latLngToCell(location.coords.latitude, location.coords.longitude, H3_RES);
                        console.log('Current H3 cell:', cell);
                      } catch (e) {
                        console.log('Location error:', e);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Debug State" onPress={() => {
                      console.log('=== DEBUG STATE ===');
                      console.log('isTracking state:', isTracking);
                      console.log('claimedCells state:', Array.from(claimedCells));
                      console.log('allHexGrid size:', allHexGrid.size);
                      console.log('cells from DB:', cells.length);
                      console.log('profile color:', profile?.color);
                      console.log('activeGroupId:', activeGroupId);
                      console.log('user ID:', user?.id);
                    }} mild />
                    <GhostButton theme={theme} title="Groups" onPress={()=>setDrawerOpen(true)} mild />
                    <GhostButton theme={theme} title="Claim Current Hex" onPress={async () => {
                      if (!isTracking) {
                        Alert.alert('Not Tracking', 'Start tracking first to claim hexagons');
                        return;
                      }
                      
                      if (!activeGroupId || !user?.id) {
                        Alert.alert('No Group', 'Join a group first to claim hexagons');
                        return;
                      }
                      
                      try {
                        console.log('🧪 Manually claiming current hexagon...');
                        const location = await Location.getCurrentPositionAsync({
                          accuracy: Location.Accuracy.Balanced,
                          timeout: 5000
                        });
                        
                        const { latitude: lat, longitude: lon } = location.coords;
                        const cell = h3.latLngToCell(lat, lon, H3_RES);
                        
                        console.log('📍 Current location:', lat.toFixed(6), lon.toFixed(6));
                        console.log('🔷 H3 cell:', cell);
                        
                        // Check if already claimed
                        if (claimedCells.has(cell)) {
                          Alert.alert('Already Claimed', `This hexagon (${cell.slice(-6)}) is already yours!`);
                          return;
                        }
                        
                        // Add to claimed cells
                        setClaimedCells(prev => {
                          const newSet = new Set([...prev, cell]);
                          console.log('Manual claim: Claimed cells updated:', Array.from(newSet));
                          return newSet;
                        });
                        
                        // Save to database
                        await captureCells([cell], activeGroupId, user.id);
                        console.log('✅ Manual hex claim successful');
                        
                        // Refresh map
                        fetchCells();
                        
                        Alert.alert('Hexagon Claimed!', `Successfully claimed hexagon ${cell.slice(-6)}`);
                        
                      } catch (e) {
                        console.log('Manual hex claim error:', e);
                        Alert.alert('Error', 'Failed to claim hexagon: ' + e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Reset Counter" onPress={() => {
                      locationCounterRef.current = 0;
                      console.log('🔄 Location counter reset to 0');
                    }} mild />
                    <GhostButton theme={theme} title="Test Interval" onPress={() => {
                      console.log('🧪 Manually testing location interval...');
                      console.log('🔍 isTracking state:', isTracking);
                      console.log('🔍 isTrackingRef.current:', isTrackingRef.current);
                      if (locationIntervalRef.current) {
                        console.log('✅ Location interval exists and is running');
                        console.log('🔍 Interval ref:', !!locationIntervalRef.current);
                        console.log('🔍 Counter:', locationCounterRef.current);
                      } else {
                        console.log('❌ Location interval is not running');
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Refresh Map" onPress={() => {
                      console.log('🔄 Manually refreshing map...');
                      console.log('🔍 Current claimed cells state:', Array.from(claimedCells));
                      console.log('🔍 Current cells from DB:', cells.length);
                      fetchCells();
                    }} mild />
                  </View>
                  <View style={{ flexDirection:'row', gap:8, justifyContent:'space-between', marginTop: 8 }}>
                    <GhostButton theme={theme} title="Refresh Grid" onPress={() => {
                      if (initialRegion) {
                        generateHexGrid(initialRegion.latitude, initialRegion.longitude);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Debug Map" onPress={() => {
                      Alert.alert('Map Debug', 
                        `Platform: ${Platform.OS}\n` +
                        `Initial Region: ${initialRegion ? 'Set' : 'Not Set'}\n` +
                        `Total Hexs: ${allHexGrid.size}\n` +
                        `My Hexs: ${claimedCells.size}\n` +
                        `Location: ${initialRegion ? `${initialRegion.latitude.toFixed(4)}, ${initialRegion.longitude.toFixed(4)}` : 'Unknown'}`
                      );
                    }} mild />
                    <GhostButton theme={theme} title="Debug Leaderboard" onPress={() => {
                      Alert.alert('Leaderboard Debug', 
                        `Active Group: ${activeGroupId || 'None'}\n` +
                        `Group Members: ${groupMembers.length}\n` +
                        `Members: ${groupMembers.map(m => `${m.displayName} (${m.role})`).join(', ') || 'None'}`
                      );
                    }} mild />
                    <GhostButton theme={theme} title="Refresh Members" onPress={() => {
                      if (activeGroupId) {
                        fetchGroupMembers();
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Debug Group DB" onPress={async () => {
                      if (!activeGroupId) {
                        Alert.alert('No Group', 'Please select a group first');
                        return;
                      }
                      
                      try {
                        // Check group_members table
                        const { data: members, error: membersError } = await supabase
                          .from('group_members')
                          .select('*')
                          .eq('group_id', activeGroupId);
                        
                        if (membersError) throw membersError;
                        
                        // Check profiles table
                        const { data: profiles, error: profilesError } = await supabase
                          .from('profiles')
                          .select('id, display_name, group_id')
                          .eq('group_id', activeGroupId);
                        
                        if (profilesError) throw profilesError;
                        
                        Alert.alert('Group Database Debug', 
                          `Group ID: ${activeGroupId}\n\n` +
                          `Group Members (${members.length}):\n${members.map(m => `- ${m.user_id} (${m.role})`).join('\n')}\n\n` +
                          `Profiles (${profiles.length}):\n${profiles.map(p => `- ${p.id}: ${p.display_name}`).join('\n')}`
                        );
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Test Add Member" onPress={async () => {
                      if (!activeGroupId) {
                        Alert.alert('No Group', 'Please select a group first');
                        return;
                      }
                      
                      try {
                        // Create a test user profile
                        const testUserId = 'test-user-' + Date.now();
                        const { error: profileError } = await supabase.from('profiles').upsert({
                          id: testUserId,
                          display_name: `TestUser${Date.now().toString().slice(-4)}`,
                          color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
                          group_id: activeGroupId
                        });
                        
                        if (profileError) throw profileError;
                        
                        // Add to group members
                        const { error: memberError } = await supabase.from('group_members').insert({
                          group_id: activeGroupId,
                          user_id: testUserId,
                          role: 'member'
                        });
                        
                        if (memberError) throw memberError;
                        
                        Alert.alert('Success', 'Test member added! Now refresh members.');
                        fetchGroupMembers();
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Test Network" onPress={async () => {
                      try {
                        const { data, error } = await supabase.from('profiles').select('count').limit(1);
                        if (error) {
                          if (error.message && error.message.includes('502 Bad Gateway')) {
                            Alert.alert('Network Issue', '502 Bad Gateway - Supabase may be down. Please try again later.');
                          } else {
                            Alert.alert('Network Error', error.message);
                          }
                        } else {
                          Alert.alert('Network OK', 'Connection to Supabase is working!');
                        }
                      } catch (e) {
                        Alert.alert('Network Error', 'Failed to connect to Supabase');
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Fix Group Members" onPress={async () => {
                      if (!activeGroupId) {
                        Alert.alert('No Group', 'Please select a group first');
                        return;
                      }
                      
                      try {
                        // First, check current group members
                        const { data: currentMembers, error: membersError } = await supabase
                          .from('group_members')
                          .select('*')
                          .eq('group_id', activeGroupId);
                        
                        if (membersError) throw membersError;
                        
                        // Check profiles for this group
                        const { data: groupProfiles, error: profilesError } = await supabase
                          .from('profiles')
                          .select('id, display_name, group_id')
                          .eq('group_id', activeGroupId);
                        
                        if (profilesError) throw profilesError;
                        
                        // Find profiles that should be in group but aren't in group_members
                        const memberUserIds = new Set(currentMembers.map(m => m.user_id));
                        const missingMembers = groupProfiles.filter(p => !memberUserIds.has(p.id));
                        
                        if (missingMembers.length === 0) {
                          Alert.alert('No Issues', 'All group members are properly linked!');
                          return;
                        }
                        
                        // Add missing members to group_members
                        const missingMemberInserts = missingMembers.map(profile => ({
                          group_id: activeGroupId,
                          user_id: profile.id,
                          role: 'member',
                          joined_at: new Date().toISOString()
                        }));
                        
                        const { error: insertError } = await supabase
                          .from('group_members')
                          .insert(missingMemberInserts);
                        
                        if (insertError) throw insertError;
                        
                        Alert.alert('Fixed!', `Added ${missingMemberInserts.length} missing members to the group.`);
                        fetchGroupMembers(); // Refresh the list
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Check My Status" onPress={async () => {
                      if (!activeGroupId || !user) {
                        Alert.alert('No Info', 'Please select a group and ensure you are logged in');
                        return;
                      }
                      
                      try {
                        // Check if current user is in group_members
                        const { data: myMembership, error: membershipError } = await supabase
                          .from('group_members')
                          .select('*')
                          .eq('group_id', activeGroupId)
                          .eq('user_id', user.id)
                          .single();
                        
                        if (membershipError && membershipError.code !== 'PGRST116') throw membershipError;
                        
                        // Check if current user has profile with correct group_id
                        const { data: myProfile, error: profileError } = await supabase
                          .from('profiles')
                          .select('*')
                          .eq('id', user.id)
                          .single();
                        
                        if (profileError) throw profileError;
                        
                        let statusMessage = `Group: ${activeGroupId}\n`;
                        statusMessage += `My User ID: ${user.id}\n`;
                        statusMessage += `My Profile Group: ${myProfile?.group_id || 'None'}\n`;
                        statusMessage += `In Group Members: ${myMembership ? 'Yes' : 'No'}\n`;
                        
                        if (myMembership) {
                          statusMessage += `My Role: ${myMembership.role}\n`;
                          statusMessage += `Joined: ${myMembership.joined_at}`;
                        }
                        
                        Alert.alert('My Group Status', statusMessage);
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Deep Debug Group" onPress={async () => {
                      if (!activeGroupId) {
                        Alert.alert('No Group', 'Please select a group first');
                        return;
                      }
                      
                      try {
                        // Get group info
                        const { data: groupInfo, error: groupError } = await supabase
                          .from('groups')
                          .select('*')
                          .eq('id', activeGroupId)
                          .single();
                        
                        if (groupError) throw groupError;
                        
                        // Get ALL group members
                        const { data: allMembers, error: membersError } = await supabase
                          .from('group_members')
                          .select('*')
                          .eq('group_id', activeGroupId)
                          .order('joined_at', { ascending: true });
                        
                        if (membersError) throw membersError;
                        
                        // Get ALL profiles for this group
                        const { data: allProfiles, error: profilesError } = await supabase
                          .from('profiles')
                          .select('*')
                          .eq('group_id', activeGroupId);
                        
                        if (profilesError) throw profilesError;
                        
                        // Find mismatches
                        const memberUserIds = new Set(allMembers.map(m => m.user_id));
                        const profileUserIds = new Set(allProfiles.map(p => p.id));
                        
                        const inMembersButNotProfiles = allMembers.filter(m => !profileUserIds.has(m.user_id));
                        const inProfilesButNotMembers = allProfiles.filter(p => !memberUserIds.has(p.id));
                        
                        let debugMessage = `🔍 GROUP DEBUG: "${groupInfo.name}"\n\n`;
                        debugMessage += `📊 Group Members (${allMembers.length}):\n`;
                        allMembers.forEach(m => {
                          debugMessage += `  - ${m.user_id} (${m.role}) - ${m.joined_at}\n`;
                        });
                        
                        debugMessage += `\n👥 Group Profiles (${allProfiles.length}):\n`;
                        allProfiles.forEach(p => {
                          debugMessage += `  - ${p.id}: ${p.display_name} (${p.color})\n`;
                        });
                        
                        if (inMembersButNotProfiles.length > 0) {
                          debugMessage += `\n⚠️ IN MEMBERS BUT NOT PROFILES:\n`;
                          inMembersButNotProfiles.forEach(m => {
                            debugMessage += `  - ${m.user_id}\n`;
                          });
                        }
                        
                        if (inProfilesButNotMembers.length > 0) {
                          debugMessage += `\n⚠️ IN PROFILES BUT NOT MEMBERS:\n`;
                          inProfilesButNotMembers.forEach(p => {
                            debugMessage += `  - ${p.id}: ${p.display_name}\n`;
                          });
                        }
                        
                        if (inMembersButNotProfiles.length === 0 && inProfilesButNotMembers.length === 0) {
                          debugMessage += `\n✅ No mismatches found!`;
                        }
                        
                        Alert.alert('Deep Debug Results', debugMessage);
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Force Sync Group" onPress={async () => {
                      if (!activeGroupId) {
                        Alert.alert('No Group', 'Please select a group first');
                        return;
                      }
                      
                      try {
                        // Get all profiles for this group
                        const { data: allProfiles, error: profilesError } = await supabase
                          .from('profiles')
                          .select('*')
                          .eq('group_id', activeGroupId);
                        
                        if (profilesError) throw profilesError;
                        
                        // Get all current group members
                        const { data: currentMembers, error: membersError } = await supabase
                          .from('group_members')
                          .select('*')
                          .eq('group_id', activeGroupId);
                        
                        if (membersError) throw membersError;
                        
                        const currentMemberIds = new Set(currentMembers.map(m => m.user_id));
                        
                        // Find profiles that should be members but aren't
                        const missingMembers = allProfiles.filter(p => !currentMemberIds.has(p.id));
                        
                        if (missingMembers.length === 0) {
                          Alert.alert('No Action Needed', 'All profiles are already group members!');
                          return;
                        }
                        
                        // Create missing member records
                        const newMembers = missingMembers.map((profile, index) => ({
                          group_id: activeGroupId,
                          user_id: profile.id,
                          role: index === 0 ? 'owner' : 'member', // First one is owner
                          joined_at: new Date().toISOString()
                        }));
                        
                        // Insert missing members
                        const { error: insertError } = await supabase
                          .from('group_members')
                          .insert(newMembers);
                        
                        if (insertError) throw insertError;
                        
                        Alert.alert('Sync Complete!', `Added ${newMembers.length} missing members to the group.`);
                        
                        // Refresh the member list
                        fetchGroupMembers();
                        
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Test Display" onPress={async () => {
                      if (!activeGroupId) {
                        Alert.alert('No Group', 'Please select a group first');
                        return;
                      }
                      
                      try {
                        // Manually test the same logic as fetchGroupMembers
                        const { data: members, error: membersError } = await supabase
                          .from('group_members')
                          .select('user_id, role, joined_at')
                          .eq('group_id', activeGroupId)
                          .order('joined_at', { ascending: true });
                        
                        if (membersError) throw membersError;
                        
                        if (!members || members.length === 0) {
                          Alert.alert('Test Result', 'No group members found in database');
                          return;
                        }
                        
                        // Fetch profiles
                        const userIds = members.map(m => m.user_id);
                        const { data: profiles, error: profilesError } = await supabase
                          .from('profiles')
                          .select('id, display_name, color')
                          .in('id', userIds);
                        
                        if (profilesError) throw profilesError;
                        
                        // Format members
                        const profileMap = new Map();
                        if (profiles) {
                          profiles.forEach(profile => {
                            profileMap.set(profile.id, profile);
                          });
                        }
                        
                        const formattedMembers = members.map(member => {
                          const profile = profileMap.get(member.user_id);
                          return {
                            userId: member.user_id,
                            role: member.role,
                            displayName: profile?.display_name || `Player${member.user_id.slice(-4)}`,
                            color: profile?.color || '#6aa2ff'
                          };
                        });
                        
                        let testMessage = `🧪 TEST DISPLAY RESULTS\n\n`;
                        testMessage += `📊 Raw Members (${members.length}):\n`;
                        members.forEach(m => testMessage += `  - ${m.user_id} (${m.role})\n`);
                        
                        testMessage += `\n🎨 Profiles Found (${profiles?.length || 0}):\n`;
                        if (profiles) {
                          profiles.forEach(p => testMessage += `  - ${p.id}: ${p.display_name}\n`);
                        }
                        
                        testMessage += `\n✅ Formatted Members (${formattedMembers.length}):\n`;
                        formattedMembers.forEach(m => testMessage += `  - ${m.displayName} (${m.role})\n`);
                        
                        Alert.alert('Test Display Results', testMessage);
                        
                        // Also update the state to see if it fixes the display
                        setGroupMembers(formattedMembers);
                        
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Force Full Refresh" onPress={async () => {
                      if (!activeGroupId) {
                        Alert.alert('No Group', 'Please select a group first');
                        return;
                      }
                      
                      try {
                        // Clear current state first
                        setGroupMembers([]);
                        
                        // Wait a moment for state to clear
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        // Force a complete refresh
                        const { data: members, error: membersError } = await supabase
                          .from('group_members')
                          .select('user_id, role, joined_at')
                          .eq('group_id', activeGroupId)
                          .order('joined_at', { ascending: true });
                        
                        if (membersError) throw membersError;
                        
                        if (!members || members.length === 0) {
                          Alert.alert('No Members', 'No group members found');
                          return;
                        }
                        
                        // Fetch all profiles
                        const userIds = members.map(m => m.user_id);
                        const { data: profiles, error: profilesError } = await supabase
                          .from('profiles')
                          .select('id, display_name, color')
                          .in('id', userIds);
                        
                        if (profilesError) throw profilesError;
                        
                        // Format all members at once
                        const profileMap = new Map();
                        if (profiles) {
                          profiles.forEach(profile => {
                            profileMap.set(profile.id, profile);
                          });
                        }
                        
                        const allFormattedMembers = members.map(member => {
                          const profile = profileMap.get(member.user_id);
                          return {
                            userId: member.user_id,
                            role: member.role,
                            displayName: profile?.display_name || `Player${member.user_id.slice(-4)}`,
                            color: profile?.color || '#6aa2ff'
                          };
                        });
                        
                        console.log('🔄 Force refresh - setting all members:', allFormattedMembers);
                        setGroupMembers(allFormattedMembers);
                        
                        Alert.alert('Refresh Complete', `Loaded ${allFormattedMembers.length} members`);
                        
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Check RLS Issue" onPress={async () => {
                      if (!activeGroupId) {
                        Alert.alert('No Group', 'Please select a group first');
                        return;
                      }
                      
                      try {
                        // Try to fetch ALL group members without any user-specific filtering
                        const { data: allMembers, error: membersError } = await supabase
                          .from('group_members')
                          .select('*')
                          .eq('group_id', activeGroupId);
                        
                        if (membersError) throw membersError;
                        
                        // Try to fetch ALL profiles for this group
                        const { data: allProfiles, error: profilesError } = await supabase
                          .from('profiles')
                          .select('*')
                          .eq('group_id', activeGroupId);
                        
                        if (profilesError) throw profilesError;
                        
                        // Check if we're getting different results than expected
                        let debugMessage = `🔍 RLS DEBUG RESULTS\n\n`;
                        debugMessage += `📊 Group Members Found: ${allMembers.length}\n`;
                        allMembers.forEach(m => {
                          debugMessage += `  - ${m.user_id} (${m.role}) - ${m.joined_at}\n`;
                        });
                        
                        debugMessage += `\n👥 Group Profiles Found: ${allProfiles.length}\n`;
                        allProfiles.forEach(p => {
                          debugMessage += `  - ${p.id}: ${p.display_name} (${p.color})\n`;
                        });
                        
                        // Check if current user is in the results
                        const currentUserInMembers = allMembers.some(m => m.user_id === user?.id);
                        const currentUserInProfiles = allProfiles.some(p => p.id === user?.id);
                        
                        debugMessage += `\n🔐 Current User Status:\n`;
                        debugMessage += `  - User ID: ${user?.id}\n`;
                        debugMessage += `  - In Members: ${currentUserInMembers ? 'Yes' : 'No'}\n`;
                        debugMessage += `  - In Profiles: ${currentUserInProfiles ? 'Yes' : 'No'}\n`;
                        
                        // Check for RLS policy issues
                        if (allMembers.length === 1 && allProfiles.length === 1) {
                          debugMessage += `\n⚠️ RLS ISSUE DETECTED!\n`;
                          debugMessage += `Only seeing 1 member/profile - likely RLS policy filtering\n`;
                          debugMessage += `Each user can only see their own data due to security policies`;
                        }
                        
                        Alert.alert('RLS Debug Results', debugMessage);
                        
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Fix RLS Policy" onPress={async () => {
                      if (!activeGroupId) {
                        Alert.alert('No Group', 'Please select a group first');
                        return;
                      }
                      
                      try {
                        // This will attempt to fix the RLS policy issue by ensuring
                        // the current user can see all members of their group
                        
                        // First, check if we're a member of this group
                        const { data: myMembership, error: membershipError } = await supabase
                          .from('group_members')
                          .select('*')
                          .eq('group_id', activeGroupId)
                          .eq('user_id', user.id)
                          .single();
                        
                        if (membershipError && membershipError.code !== 'PGRST116') throw membershipError;
                        
                        if (!myMembership) {
                          Alert.alert('Not a Member', 'You are not a member of this group');
                          return;
                        }
                        
                        // Now try to fetch all members using a different approach
                        // This bypasses potential RLS issues by using the group relationship
                        const { data: allMembers, error: membersError } = await supabase
                          .from('group_members')
                          .select(`
                            user_id,
                            role,
                            joined_at,
                            profiles!inner(
                              id,
                              display_name,
                              color
                            )
                          `)
                          .eq('group_id', activeGroupId)
                          .order('joined_at', { ascending: true });
                        
                        if (membersError) throw membersError;
                        
                        if (!allMembers || allMembers.length === 0) {
                          Alert.alert('No Members', 'No group members found');
                          return;
                        }
                        
                        // Format the members
                        const formattedMembers = allMembers.map(member => ({
                          userId: member.user_id,
                          role: member.role,
                          displayName: member.profiles?.display_name || `Player${member.user_id.slice(-4)}`,
                          color: member.profiles?.color || '#6aa2ff'
                        }));
                        
                        console.log('🔧 RLS Fix - setting all members:', formattedMembers);
                        setGroupMembers(formattedMembers);
                        
                        Alert.alert('RLS Fix Applied', `Loaded ${formattedMembers.length} members using group relationship`);
                        
                      } catch (e) {
                        Alert.alert('Error', e.message);
                      }
                    }} mild />
                    <GhostButton theme={theme} title="Sign out" onPress={signOut} danger />
                  </View>
                </>
              )}
            </ScrollView>
          </Card>
        </Animated.View>
      </View>

      <GroupsDrawer
        visible={drawerOpen}
        onClose={()=>setDrawerOpen(false)}
        activeGroupId={activeGroupId}
        onSelectGroup={(gid)=>{ 
          setActiveGroupId(gid); 
          setDrawerOpen(false);
          // Fetch group members immediately when group is selected
          setTimeout(() => fetchGroupMembers(), 100);
        }}
        refreshCells={fetchCells}
        theme={theme}
        userId={user?.id}
      />

      <LeaderboardDrawer
        visible={leaderboardOpen}
        onClose={()=>setLeaderboardOpen(false)}
        theme={theme}
        groupMembers={groupMembers}
        activeGroupId={activeGroupId}
      />
    </SafeAreaView>
  );
}

/* ------------------ STYLES ------------------ */
const styles = StyleSheet.create({
  screen:{ flex:1 },
  header:{ paddingHorizontal:20, paddingTop: Platform.select({ ios: 16, android: 40 }), paddingBottom:14, borderBottomWidth:StyleSheet.hairlineWidth },
  brand:{ fontSize:20, fontWeight:'800', letterSpacing:.3 },
  subtitle:{ marginTop:2, fontSize:12 },
  headerButton:{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, borderWidth:1 },
  headerButtonText:{ fontWeight:'700' },

  centerWrap:{ padding:20, paddingBottom:32 },
  card:{ borderRadius:16, padding:16, shadowColor:'#000', shadowOpacity:.2, shadowRadius:12, shadowOffset:{width:0,height:8}, borderWidth:1 },
  cardTitle:{ fontSize:18, fontWeight:'700' },
  cardHint:{ fontSize:12, marginTop:4 },

  label:{ marginBottom:6, fontSize:13 },
  input:{ padding:12, borderRadius:12, borderWidth:1 },
  formRow:{ marginTop:12 },
  rowGap:{ marginTop:14, gap:10 },

  buttonPrimary:{ paddingVertical:14, borderRadius:14, alignItems:'center' },
  buttonPrimaryText:{ color:'white', fontWeight:'700', fontSize:16 },
  buttonGhost:{ paddingVertical:12, borderRadius:14, alignItems:'center', borderWidth:1 },
  buttonGhostText:{ fontWeight:'700', fontSize:16 },

  timer:{ fontSize:28, fontWeight:'800', marginTop:6, letterSpacing:1 },

  statRow:{ flexDirection:'row', gap:12, marginTop: 8 },
  statCard:{ flex:1, padding:12, borderRadius:12, borderWidth:1 },
  statLabel:{ fontSize:12 },
  statValue:{ fontSize:18, fontWeight:'700', marginTop:2 },

  bottomSheet:{ position:'absolute', left:0, right:0, bottom:0, paddingHorizontal:12, paddingBottom:16 },

  drawerWrap:{ position:'absolute', top:0, bottom:0, left:0, width:'80%', backgroundColor:'#00000055' },
  drawerWrapRight:{ position:'absolute', top:0, bottom:0, right:0, width:'80%', backgroundColor:'#00000055' },
  drawer:{ flex:1, width:'100%', borderRightWidth:1 },
  drawerHeader:{ paddingHorizontal:16, paddingBottom:12, borderBottomWidth:1, flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  drawerTitle:{ fontSize:16, fontWeight:'800' },
  drawerClose:{ paddingVertical:8, paddingHorizontal:10, borderWidth:1, borderRadius:10 },

  groupRow:{ padding:12, borderRadius:12, borderWidth:1, flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  groupName:{ fontWeight:'700' },

  memberRow:{ padding:12, borderRadius:12, borderWidth:1, flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  memberName:{ fontWeight:'600' },

  sectionDivider:{ height:1, marginVertical:10 },
  sectionTitle:{ fontWeight:'700', fontSize:14 },
  map:{ flex:1 },
});
