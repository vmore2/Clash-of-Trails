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
            // Prefer Canvas renderer for much faster polygon rendering on Android
            let map = L.map('map', { preferCanvas: true }).setView([${region.latitude}, ${region.longitude}], 15);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            // User location tracking removed - no more red marker
            let userMarker = null;
            let accuracyCircle = null;
            
            function updateUserLocation(lat, lng) {
                // Location tracking disabled - no visual marker
            }

            const canvasRenderer = L.canvas({ padding: 0.5 });
            // Separate layers to prevent background from being wiped on frequent updates
            let importantLayerGroup = L.layerGroup().addTo(map);
            let backgroundLayerGroup = L.layerGroup().addTo(map);
            let isDrawingImportant = false;
            let pendingImportant = null;
            let isDrawingBackground = false;
            let pendingBackground = null;
            let lastBackgroundCount = 0;

            function updateHexagons(hexagons) {
                // If an important draw is in progress, queue the latest update and return
                if (isDrawingImportant) {
                    pendingImportant = hexagons || [];
                    return;
                }

                isDrawingImportant = true;

                // Always clear and redraw important layer quickly
                importantLayerGroup.clearLayers();

                if (!hexagons || hexagons.length === 0) {
                    isDrawingImportant = false;
                    return;
                }

                // Split into important vs background to ensure unclaimed draw progressively
                const important = [];
                const background = [];
                for (let i = 0; i < hexagons.length; i++) {
                    const t = hexagons[i]?.type;
                    if (t === 'unclaimed') background.push(hexagons[i]); else important.push(hexagons[i]);
                }

                // Batch sizes per frame
                const importantBatch = 900;
                const backgroundBatch = 700;
                let impIndex = 0;
                let bgIndex = 0;

                function drawSome(list, start, count, targetGroup) {
                    const end = Math.min(start + count, list.length);
                    for (let i = start; i < end; i++) {
                        const hex = list[i];
                        if (!hex || !hex.coords || hex.coords.length < 3) continue;
                        try {
                            const leafletCoords = hex.coords
                                .map(coord => (coord && typeof coord.latitude === 'number' && typeof coord.longitude === 'number')
                                    ? [coord.latitude, coord.longitude]
                                    : null)
                                .filter(Boolean);
                            if (leafletCoords.length < 3) continue;

                            // Style
                            let style = {};
                            if (hex.type === 'unclaimed') {
                                // Stronger, more visible background grid on Android
                                style = {
                                    color: '#7f8aa5',
                                    weight: 1.4,
                                    fillColor: '#dae1f1',
                                    fillOpacity: 0.35,
                                    opacity: 0.9,
                                    interactive: false,
                                    renderer: canvasRenderer
                                };
                            } else if (hex.type === 'claimed') {
                                style = {
                                    color: hex.stroke || '#4CAF50',
                                    weight: 2,
                                    fillColor: hex.fill || '#4CAF50',
                                    fillOpacity: 0.4,
                                    opacity: 1,
                                    renderer: canvasRenderer
                                };
                            } else if (hex.type === 'owned' || hex.type === 'my-territory' || hex.type === 'other-territory' || hex.type === 'shared') {
                                const w = hex.strokeWidth || (hex.subtype === 'mine' ? 2.5 : 1.5);
                                style = {
                                    color: hex.stroke || '#2196F3',
                                    weight: w,
                                    fillColor: hex.fill || '#2196F3',
                                    fillOpacity: (hex.subtype === 'mine') ? 0.4 : 0.15,
                                    opacity: (hex.subtype === 'mine') ? 0.9 : 0.7,
                                    dashArray: (hex.subtype === 'other') ? '5, 5' : null,
                                    renderer: canvasRenderer
                                };
                            } else if (hex.type === 'live' || hex.type === 'local-claimed') {
                                style = {
                                    color: hex.stroke || '#FF5722',
                                    weight: hex.strokeWidth || 3,
                                    fillColor: hex.fill || '#FF5722',
                                    fillOpacity: 0.6,
                                    opacity: 1,
                                    renderer: canvasRenderer
                                };
                            } else {
                                style = {
                                    color: hex.stroke || '#666',
                                    weight: hex.strokeWidth || 2,
                                    fillColor: hex.fill || '#666',
                                    fillOpacity: 0.3,
                                    opacity: 1,
                                    renderer: canvasRenderer
                                };
                            }

                            const polygon = L.polygon(leafletCoords, style);

                            // Avoid heavy interactivity for unclaimed background
                            if (hex.type !== 'unclaimed') {
                                polygon.on('mouseover', function() {
                                    this.setStyle({
                                        weight: (style.weight || 2) + 1,
                                        opacity: Math.min((style.opacity || 1) + 0.2, 1)
                                    });
                                });
                                polygon.on('mouseout', function() {
                                    this.setStyle(style);
                                });
                                if (hex.type) {
                                    let tooltipText = hex.type.charAt(0).toUpperCase() + hex.type.slice(1);
                                    if (hex.owner) {
                                        tooltipText += ' by ' + hex.owner;
                                    }
                                    if (hex.subtype === 'mine') {
                                        tooltipText = '👑 My Territory';
                                    } else if (hex.subtype === 'other') {
                                        tooltipText = '🏴 ' + (hex.owner || 'Other Player') + "'s Territory";
                                    }
                                    polygon.bindTooltip(tooltipText, { permanent: false, direction: 'center', className: 'hex-tooltip' });
                                }
                            }

                            polygon.addTo(targetGroup);
                        } catch (e) {
                            // ignore
                        }
                    }

                    return end;
                }

                function drawImportantThenBackground() {
                    // Draw important layer fully, fast
                    impIndex = drawSome(important, impIndex, importantBatch, importantLayerGroup);
                    if (impIndex < important.length) {
                        requestAnimationFrame(drawImportantThenBackground);
                        return;
                    }

                    // Important done
                    isDrawingImportant = false;
                    if (pendingImportant) {
                        const next = pendingImportant; pendingImportant = null;
                        updateHexagons(next);
                        return;
                    }

                    // Only rebuild background if changed
                    if (background.length !== lastBackgroundCount) {
                        lastBackgroundCount = background.length;
                        queueBackgroundDraw(background);
                    }
                }

                function queueBackgroundDraw(bgList) {
                    if (isDrawingBackground) {
                        pendingBackground = bgList;
                        return;
                    }
                    isDrawingBackground = true;
                    backgroundLayerGroup.clearLayers();

                    let bgIndex = 0;
                    function drawBgChunk() {
                        bgIndex = drawSome(bgList, bgIndex, backgroundBatch, backgroundLayerGroup);
                        if (bgIndex < bgList.length) {
                            requestAnimationFrame(drawBgChunk);
                            return;
                        }
                        isDrawingBackground = false;
                        if (pendingBackground) {
                            const nextBg = pendingBackground; pendingBackground = null;
                            queueBackgroundDraw(nextBg);
                        }
                    }
                    requestAnimationFrame(drawBgChunk);
                }

                requestAnimationFrame(drawImportantThenBackground);
            }

            // Listen for messages from React Native
            document.addEventListener('message', function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'updateHexagons') {
                        updateHexagons(data.hexagons);
                    } else if (data.type === 'updateCenter') {
                        map.setView([data.region.latitude, data.region.longitude], 15);
                        updateUserLocation(data.region.latitude, data.region.longitude);
                    } else if (data.type === 'updateUserLocation') {
                        updateUserLocation(data.lat, data.lng);
                    }
                } catch (error) {
                    // Silently handle error for production
                }
            });
            
            // Also listen on window for cross-compatibility
            window.addEventListener('message', function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'updateHexagons') {
                        updateHexagons(data.hexagons);
                    } else if (data.type === 'updateCenter') {
                        map.setView([data.region.latitude, data.region.longitude], 15);
                        updateUserLocation(data.region.latitude, data.region.longitude);
                    } else if (data.type === 'updateUserLocation') {
                        updateUserLocation(data.lat, data.lng);
                    }
                } catch (error) {
                    // Silently handle error for production
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

            // Set initial user location
            updateUserLocation(${region.latitude}, ${region.longitude});

            // Initial load complete
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'mapReady'
            }));
            
            // Map initialized
            
            // Fallback: check for hexagons after a delay
            setTimeout(function() {
                try {
                    const imp = (importantLayerGroup && importantLayerGroup.getLayers) ? importantLayerGroup.getLayers().length : 0;
                    const bg = (backgroundLayerGroup && backgroundLayerGroup.getLayers) ? backgroundLayerGroup.getLayers().length : 0;
                    if ((imp + bg) === 0) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'requestHexagons' }));
                    }
                } catch (e) { /* ignore */ }
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

