// MapViewScreen.js
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, ActivityIndicator, Pressable, Text, StyleSheet } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import * as h3 from 'h3-js';
import { supabase } from './lib/supabase';

MapboxGL.setAccessToken(null); // we use free OSM raster tiles

const styleJSON = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
};

export default function MapViewScreen({ groupId }) {
  const [loading, setLoading] = useState(true);
  const [cells, setCells] = useState([]); // [{ h3_id, owner_user_id, color }]

  const fetchCells = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('cells_for_group', { p_group: groupId });
    if (!error) setCells(data || []);
    setLoading(false);
  }, [groupId]);

  useEffect(() => { fetchCells(); }, [fetchCells]);

  const features = useMemo(() => {
    // One polygon per (cell, owner) so co-owners show as overlapping translucent fills
    return (cells || []).map((row, i) => {
      const boundary = h3.cellToBoundary(row.h3_id, true); // [[lat,lon]...]
      const coords = [boundary.map(([lat, lon]) => [lon, lat])]; // GeoJSON lng/lat
      return {
        type: 'Feature',
        id: String(i),
        properties: { fill: row.color || '#888' },
        geometry: { type: 'Polygon', coordinates: coords }
      };
    });
  }, [cells]);

  const collection = useMemo(() => ({
    type: 'FeatureCollection',
    features
  }), [features]);

  return (
    <View style={{ flex: 1 }}>
      <MapboxGL.MapView style={{ flex: 1 }} styleJSON={styleJSON}>
        <MapboxGL.Camera zoomLevel={14} followUserLocation followUserMode="normal" />
        <MapboxGL.UserLocation visible showsUserHeadingIndicator />

        {features.length ? (
          <MapboxGL.ShapeSource id="cells" shape={collection}>
            <MapboxGL.FillLayer id="cells-fill" style={{ fillColor: ['get', 'fill'], fillOpacity: 0.35 }} />
            <MapboxGL.LineLayer id="cells-outline" style={{ lineWidth: 1, lineColor: '#333' }} />
          </MapboxGL.ShapeSource>
        ) : null}
      </MapboxGL.MapView>

      <View style={styles.overlay}>
        <Pressable onPress={fetchCells} style={styles.refresh}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color="white" />
          <Text style={{ color: 'white', marginTop: 6 }}>Loading territories…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 16, right: 16 },
  refresh: { backgroundColor: '#161a2b', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#262a44' },
  refreshText: { color: '#cbd0e6', fontWeight: '700' },
  loading: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000040' }
});
