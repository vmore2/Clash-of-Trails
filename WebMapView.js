import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { WebView } from 'react-native-webview';
import { Platform } from 'react-native';

const WebMapView = forwardRef(({ initialRegion, hexagons, onRegionChange, style }, ref) => {
  const webViewRef = useRef(null);

  // Use default location if initialRegion is null
  const region = initialRegion || { latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.02, longitudeDelta: 0.02 };

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Map</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
            body { margin: 0; padding: 0; }
            #map { height: 100vh; width: 100vw; }
            
            .hex-tooltip {
                background: rgba(0, 0, 0, 0.8);
                color: white;
                border: none;
                border-radius: 4px;
                padding: 4px 8px;
                font-size: 12px;
                font-weight: 500;
            }
            
            .hex-tooltip::before {
                display: none;
            }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            let map = L.map('map').setView([${region.latitude}, ${region.longitude}], 15);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            // Add user location marker
            let userMarker = null;
            let accuracyCircle = null;
            
            function updateUserLocation(lat, lng) {
                // Remove old markers
                if (userMarker) {
                    map.removeLayer(userMarker);
                }
                if (accuracyCircle) {
                    map.removeLayer(accuracyCircle);
                }
                
                // Add new user location marker
                userMarker = L.circleMarker([lat, lng], {
                    color: '#007AFF',
                    fillColor: '#007AFF',
                    fillOpacity: 0.9,
                    radius: 10,
                    weight: 3
                }).addTo(map);
                
                // Add accuracy circle
                accuracyCircle = L.circle([lat, lng], {
                    color: '#007AFF',
                    fillColor: '#007AFF',
                    fillOpacity: 0.1,
                    weight: 1,
                    radius: 15 // 15 meter accuracy estimate
                }).addTo(map);
                
                console.log('WebMap: Updated user location to', lat, lng);
            }

            let hexagonLayers = [];

            function updateHexagons(hexagons) {
                // Clear existing hexagons
                hexagonLayers.forEach(layer => map.removeLayer(layer));
                hexagonLayers = [];

                console.log('WebMap: Updating hexagons, count:', hexagons.length);
                
                if (hexagons.length === 0) {
                    console.log('WebMap: No hexagons to render');
                    return;
                }

                // Add new hexagons
                hexagons.forEach((hex, index) => {
                    if (hex.coords && hex.coords.length > 0) {
                        try {
                            // Convert coordinates from {latitude, longitude} to [lat, lng] format for Leaflet
                            const leafletCoords = hex.coords.map(coord => {
                                if (coord && typeof coord.latitude === 'number' && typeof coord.longitude === 'number') {
                                    return [coord.latitude, coord.longitude];
                                }
                                console.log('WebMap: Invalid coord:', coord);
                                return null;
                            }).filter(Boolean);
                            
                            if (index === 0) {
                                console.log('WebMap: First hex coords sample:', hex.coords.slice(0, 2));
                                console.log('WebMap: Converted to:', leafletCoords.slice(0, 2));
                                console.log('WebMap: Hex style:', { fill: hex.fill, stroke: hex.stroke, strokeWidth: hex.strokeWidth });
                            }
                            
                            if (leafletCoords.length >= 3) {
                                                        // Enhanced styling based on hex type
                        let style = {};
                        
                        if (hex.type === 'unclaimed') {
                            style = {
                                color: '#8B9DC3',
                                weight: 1,
                                fillColor: '#E8EAF6',
                                fillOpacity: 0.2,
                                opacity: 0.6,
                                dashArray: '3, 3' // Dashed border for unclaimed
                            };
                        } else if (hex.type === 'claimed') {
                            style = {
                                color: hex.stroke || '#4CAF50',
                                weight: 2,
                                fillColor: hex.fill || '#4CAF50',
                                fillOpacity: 0.4,
                                opacity: 1
                            };
                        } else if (hex.type === 'owned') {
                            if (hex.subtype === 'mine') {
                                // My territory - solid and prominent
                                style = {
                                    color: hex.stroke || '#2196F3',
                                    weight: hex.strokeWidth || 2.5,
                                    fillColor: hex.fill || '#2196F3',
                                    fillOpacity: 0.4,
                                    opacity: 0.9
                                };
                            } else {
                                // Other player's territory - beautiful transparent
                                style = {
                                    color: hex.stroke || '#2196F3',
                                    weight: hex.strokeWidth || 1.5,
                                    fillColor: hex.fill || '#2196F3',
                                    fillOpacity: 0.15,
                                    opacity: 0.7,
                                    dashArray: '5, 5' // Dashed border for others
                                };
                            }
                        } else if (hex.type === 'live') {
                            // Live tracking (bright and prominent)
                            style = {
                                color: hex.stroke || '#FF5722',
                                weight: hex.strokeWidth || 3,
                                fillColor: hex.fill || '#FF5722',
                                fillOpacity: 0.6,
                                opacity: 1
                            };
                        } else {
                            // Fallback style
                            style = {
                                color: hex.stroke || '#666',
                                weight: hex.strokeWidth || 2,
                                fillColor: hex.fill || '#666',
                                fillOpacity: 0.3,
                                opacity: 1
                            };
                        }
                        
                                                const polygon = L.polygon(leafletCoords, style).addTo(map);
                        
                        // Add hover effects for better interactivity
                        polygon.on('mouseover', function() {
                            this.setStyle({
                                weight: (style.weight || 2) + 1,
                                opacity: Math.min((style.opacity || 1) + 0.2, 1)
                            });
                        });
                        
                        polygon.on('mouseout', function() {
                            this.setStyle(style);
                        });
                        
                        // Add tooltip with hex info and owner
                        if (hex.type) {
                            let tooltipText = hex.type.charAt(0).toUpperCase() + hex.type.slice(1);
                            if (hex.owner) {
                                tooltipText += ' by ' + hex.owner;
                            }
                            if (hex.subtype === 'mine') {
                                tooltipText = '👑 My Territory';
                            } else if (hex.subtype === 'other') {
                                tooltipText = '🏴 ' + (hex.owner || 'Other Player') + '\\'s Territory';
                            }
                            
                            polygon.bindTooltip(tooltipText, {
                                permanent: false,
                                direction: 'center',
                                className: 'hex-tooltip'
                            });
                        }
                        
                        hexagonLayers.push(polygon);
                            } else {
                                console.log('WebMap: Not enough valid coords for hex', index);
                            }
                        } catch (error) {
                            console.log('WebMap: Error adding hex', index, error);
                        }
                    }
                });
                console.log('WebMap: Added', hexagonLayers.length, 'hexagon layers');
            }

            // Listen for messages from React Native
            document.addEventListener('message', function(event) {
                try {
                    const data = JSON.parse(event.data);
                    console.log('WebMap received message (document):', data.type, data.hexagons ? data.hexagons.length : 0);
                    if (data.type === 'updateHexagons') {
                        updateHexagons(data.hexagons);
                    } else if (data.type === 'updateCenter') {
                        console.log('WebMap: Updating center to:', data.region);
                        map.setView([data.region.latitude, data.region.longitude], 15);
                        updateUserLocation(data.region.latitude, data.region.longitude);
                    } else if (data.type === 'updateUserLocation') {
                        console.log('WebMap: Updating user location to:', data.lat, data.lng);
                        updateUserLocation(data.lat, data.lng);
                    }
                } catch (error) {
                    console.log('WebMap message parse error:', error);
                }
            });
            
            // Also listen on window for cross-compatibility
            window.addEventListener('message', function(event) {
                try {
                    const data = JSON.parse(event.data);
                    console.log('WebMap received message (window):', data.type, data.hexagons ? data.hexagons.length : 0);
                    if (data.type === 'updateHexagons') {
                        updateHexagons(data.hexagons);
                    } else if (data.type === 'updateCenter') {
                        console.log('WebMap: Updating center to:', data.region);
                        map.setView([data.region.latitude, data.region.longitude], 15);
                        updateUserLocation(data.region.latitude, data.region.longitude);
                    } else if (data.type === 'updateUserLocation') {
                        console.log('WebMap: Updating user location to:', data.lat, data.lng);
                        updateUserLocation(data.lat, data.lng);
                    }
                } catch (error) {
                    console.log('WebMap message parse error:', error);
                }
            });

            // Send region changes back to React Native
            map.on('moveend', function() {
                const center = map.getCenter();
                const bounds = map.getBounds();
                const region = {
                    latitude: center.lat,
                    longitude: center.lng,
                    latitudeDelta: bounds.getNorth() - bounds.getSouth(),
                    longitudeDelta: bounds.getEast() - bounds.getWest()
                };
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'regionChange',
                    region: region
                }));
            });

            // Remove test square since hexagons are working now
            console.log('WebMap: Ready for hexagon rendering');

            // Set initial user location
            updateUserLocation(${region.latitude}, ${region.longitude});

            // Initial load complete
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'mapReady'
            }));
            
            // Map initialized
            
            // Fallback: check for hexagons after a delay
            setTimeout(function() {
                if (hexagonLayers.length === 0) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'requestHexagons'
                    }));
                }
            }, 2000);
        </script>
    </body>
    </html>
  `;

  useEffect(() => {
    if (webViewRef.current && hexagons) {
      const message = JSON.stringify({
        type: 'updateHexagons',
        hexagons: hexagons
      });
      webViewRef.current.postMessage(message);
    }
  }, [hexagons]);

  // Update map center when initialRegion changes
  useEffect(() => {
    if (webViewRef.current && initialRegion) {
      const message = JSON.stringify({
        type: 'updateCenter',
        region: initialRegion
      });
      webViewRef.current.postMessage(message);
    }
  }, [initialRegion]);

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'regionChange' && onRegionChange) {
        onRegionChange(data.region);
      } else if (data.type === 'mapReady') {
        // Map is ready
      } else if (data.type === 'requestHexagons') {
        if (webViewRef.current && hexagons) {
          const message = JSON.stringify({
            type: 'updateHexagons',
            hexagons: hexagons
          });
          webViewRef.current.postMessage(message);
        }
      }
    } catch (error) {
      // Silent error handling
    }
  };

  // Expose postMessage method to parent ref
  useImperativeHandle(ref, () => ({
    postMessage: (message) => {
      if (webViewRef.current) {
        webViewRef.current.postMessage(message);
      }
    }
  }));

  return (
    <WebView
      ref={webViewRef}
      source={{ html: htmlContent }}
      style={style}
      onMessage={handleMessage}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      startInLoadingState={true}
      mixedContentMode="compatibility"
      allowsFullscreenVideo={false}
      allowsInlineMediaPlayback={true}
      mediaPlaybackRequiresUserAction={false}
    />
  );
});

export default WebMapView; 