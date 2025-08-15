// GroupGate.js
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Alert, StyleSheet } from 'react-native';
import { supabase } from './lib/supabase';

const Input = (p) => <TextInput placeholderTextColor="#8a8ea3" {...p} style={[styles.input, p.style]} />;
const Primary = ({ title, onPress }) => (
  <Text onPress={onPress} style={styles.btnPrimary}>{title}</Text>
);
const Secondary = ({ title, onPress }) => (
  <Text onPress={onPress} style={styles.btnSecondary}>{title}</Text>
);

export default function GroupGate({ onReady }) {
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('My Crew');
  const [code, setCode] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('group_members').select('group_id').limit(1);
      if (data && data.length) onReady(data[0].group_id);
      setLoading(false);
    })();
  }, []);

  async function createGroup() {
    const { data, error } = await supabase.rpc('create_group', { p_name: newName });
    if (error) return Alert.alert('Error', error.message);
    const { group_id, join_code } = data[0];
    Alert.alert('Group created', `Share code: ${join_code}`);
    onReady(group_id);
  }
  async function joinGroup() {
    const codeTrim = code.trim();
    if (!codeTrim) return Alert.alert('Missing code', 'Enter a join code.');
    const { data, error } = await supabase.rpc('join_group', { p_code: codeTrim });
    if (error) return Alert.alert('Error', error.message);
    onReady(data);
  }

  if (loading) return null;

  return (
    <View style={{ gap: 14 }}>
      <Text style={styles.title}>Create a group</Text>
      <Input value={newName} onChangeText={setNewName} />
      <Text style={styles.btnPrimary} onPress={createGroup}>Create</Text>

      <Text style={[styles.title, { marginTop: 12 }]}>Or join</Text>
      <Input placeholder="Join code" autoCapitalize="none" value={code} onChangeText={setCode} />
      <Text style={styles.btnSecondary} onPress={joinGroup}>Join</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: '#0f1324', color: 'white', padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: '#22273d'
  },
  title: { color: 'white', fontWeight: '700', fontSize: 16 },
  btnPrimary: {
    backgroundColor: '#4f7df3', color: 'white', textAlign: 'center', paddingVertical: 12,
    borderRadius: 12, overflow: 'hidden', fontWeight: '700'
  },
  btnSecondary: {
    borderColor: '#3a3f5a', borderWidth: 1, color: '#cbd0e6', textAlign: 'center',
    paddingVertical: 12, borderRadius: 12, overflow: 'hidden', fontWeight: '700'
  },
});
