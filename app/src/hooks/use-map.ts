import { useState, useCallback, useRef } from 'react';
import { uint32ToRgb } from '../lib/colors';
import type { Map as LeafletMap } from 'leaflet';
import * as L from 'leaflet';
import { latLonToGlobalPx, globalPxToLatLon } from '../lib/projection';
import { PIXEL_SELECT_ZOOM } from '../constants';

// Crosshair SVG for pixel highlighter (corner brackets only)
const CROSSHAIR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width="100%" height="100%">
  <path d="M4 20 L4 4 L20 4" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none"/>
  <path d="M44 4 L60 4 L60 20" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none"/>
  <path d="M60 44 L60 60 L44 60" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none"/>
  <path d="M20 60 L4 60 L4 44" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none"/>
</svg>`;

export interface PixelData {
    px: number;
    py: number;
    color: number;
    timestamp: number;
}

interface UseMapState {
    selectedPixel: { px: number; py: number } | null;
    hoveredPixel: { px: number; py: number } | null;
}

export function useMap() {
    const mapRef = useRef<LeafletMap | null>(null);
    const [state, setState] = useState<UseMapState>({
        selectedPixel: null,
        hoveredPixel: null,
    });
    const [placedPixelCount, setPlacedPixelCount] = useState(0);
    const [localPixels, setLocalPixels] = useState<PixelData[]>([]);

    // Store pixel colors in a map for efficient updates
    const pixelDataRef = useRef<Map<string, number>>(new Map());
    const markersRef = useRef<Map<string, L.Rectangle | L.CircleMarker>>(new Map());
    const hoverHighlightRef = useRef<L.Rectangle | null>(null);
    const hoverCrosshairRef = useRef<L.Marker | null>(null);
    const selectedHighlightRef = useRef<L.Rectangle | null>(null);

    // Internal marker update function
    const updateMarkerInternal = useCallback((px: number, py: number, color: number) => {
        if (!mapRef.current) return;

        const pixelKey = `${px},${py}`;
        const rgb = uint32ToRgb(color);
        const hexColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

        let marker = markersRef.current.get(pixelKey);
        if (marker) {
            marker.setStyle({ fillColor: hexColor, color: hexColor });
        } else {
            const { lat: lat1, lon: lon1 } = globalPxToLatLon(px, py);
            const { lat: lat2, lon: lon2 } = globalPxToLatLon(px + 1, py + 1);

            const bounds: [[number, number], [number, number]] = [
                [Math.min(lat1, lat2), Math.min(lon1, lon2)],
                [Math.max(lat1, lat2), Math.max(lon1, lon2)]
            ];

            const newMarker = L.rectangle(bounds, {
                fillColor: hexColor,
                color: hexColor,
                weight: 0,
                opacity: 1,
                fillOpacity: 1,
            });

            newMarker.on('click', () => {
                setState((prev) => ({ ...prev, selectedPixel: { px, py } }));
            });

            try {
                newMarker.addTo(mapRef.current!);
                markersRef.current.set(pixelKey, newMarker);
            } catch (err) {
                console.error(`❌ Failed to add marker at (${px}, ${py}):`, err);
            }
        }
    }, []);

    // Public marker update function
    const updateMarker = useCallback((px: number, py: number, color: number) => {
        pixelDataRef.current.set(`${px},${py}`, color);
        updateMarkerInternal(px, py, color);
        setPlacedPixelCount(pixelDataRef.current.size);
        
        // Add to local pixels list
        const pixelData: PixelData = {
            px,
            py,
            color,
            timestamp: Math.floor(Date.now() / 1000),
        };
        setLocalPixels(prev => {
            const filtered = prev.filter(p => !(p.px === px && p.py === py));
            return [pixelData, ...filtered].slice(0, 50);
        });
    }, [updateMarkerInternal]);

    // Remove marker
    const removeMarker = useCallback((pixelKey: string) => {
        const marker = markersRef.current.get(pixelKey);
        if (marker && mapRef.current) {
            mapRef.current.removeLayer(marker);
            markersRef.current.delete(pixelKey);
        }
        pixelDataRef.current.delete(pixelKey);
        setPlacedPixelCount(pixelDataRef.current.size);
        
        // Remove from local pixels list
        const [px, py] = pixelKey.split(',').map(Number);
        setLocalPixels(prev => prev.filter(p => !(p.px === px && p.py === py)));
    }, []);

    // Initialize map
    const initializeMap = useCallback((map: LeafletMap) => {
        mapRef.current = map;
    }, []);

    // Helper to show/update the selection highlight
    const showSelectionHighlight = useCallback((px: number, py: number, selectedColor?: string) => {
        if (!mapRef.current) return;

        const { lat: lat1, lon: lon1 } = globalPxToLatLon(px, py);
        const { lat: lat2, lon: lon2 } = globalPxToLatLon(px + 1, py + 1);

        const bounds: [[number, number], [number, number]] = [
            [Math.min(lat1, lat2), Math.min(lon1, lon2)],
            [Math.max(lat1, lat2), Math.max(lon1, lon2)]
        ];

        let fillColor = 'rgba(255, 255, 255, 0.3)';

        if (selectedColor) {
            const hex = selectedColor.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
        }

        // Update or create rectangle highlight
        if (selectedHighlightRef.current) {
            selectedHighlightRef.current.setBounds(bounds);
            selectedHighlightRef.current.setStyle({
                fillColor,
                stroke: false,
                fillOpacity: 0.5,
            });
        } else {
            const highlight = L.rectangle(bounds, {
                fillColor,
                stroke: false,
                fillOpacity: 0.5,
                interactive: false,
            });
            highlight.addTo(mapRef.current);
            selectedHighlightRef.current = highlight;
        }
    }, []);

    // Focus on a specific pixel with smooth animation
    const focusOnPixel = useCallback((px: number, py: number, zoom?: number) => {
        if (!mapRef.current) return;

        const { lat, lon } = globalPxToLatLon(px, py);
        const currentZoom = mapRef.current.getZoom();
        const targetZoom = zoom !== undefined ? zoom : (currentZoom < PIXEL_SELECT_ZOOM ? PIXEL_SELECT_ZOOM : currentZoom);

        if (selectedHighlightRef.current) {
            mapRef.current.removeLayer(selectedHighlightRef.current);
            selectedHighlightRef.current = null;
        }

        // Calculate offset to account for bottom panel (~200px)
        const bottomPanelOffset = 90;
        const degreesPerPixel = 360 / (256 * Math.pow(2, targetZoom));
        const latOffset = bottomPanelOffset * degreesPerPixel;

        mapRef.current.flyTo([lat - latOffset, lon], targetZoom, {
            duration: 1.2,
            easeLinearity: 0.25,
        });

        const onMoveEnd = () => {
            showSelectionHighlight(px, py);
            mapRef.current?.off('moveend', onMoveEnd);
        };
        mapRef.current.on('moveend', onMoveEnd);

        setState((prev) => ({ ...prev, selectedPixel: { px, py } }));
    }, [showSelectionHighlight]);

    // Handle map hover
    const handleMapHover = useCallback((lat: number, lng: number, selectedColor?: string) => {
        if (!mapRef.current) return;

        const { px, py } = latLonToGlobalPx(lat, lng);
        setState((prev) => ({ ...prev, hoveredPixel: { px, py } }));

        const { lat: lat1, lon: lon1 } = globalPxToLatLon(px, py);
        const { lat: lat2, lon: lon2 } = globalPxToLatLon(px + 1, py + 1);

        const bounds: [[number, number], [number, number]] = [
            [Math.min(lat1, lat2), Math.min(lon1, lon2)],
            [Math.max(lat1, lat2), Math.max(lon1, lon2)]
        ];

        // Calculate center of pixel for crosshair
        const centerLat = (lat1 + lat2) / 2;
        const centerLon = (lon1 + lon2) / 2;

        let fillColor = 'rgba(255, 255, 255, 0.3)';
        let crosshairColor = '#1e40af'; // Default blue

        if (selectedColor) {
            const hex = selectedColor.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
            // Use a contrasting color for the crosshair
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            crosshairColor = brightness > 128 ? '#1e3a5f' : '#ffffff';
        }

        if (hoverHighlightRef.current) {
            hoverHighlightRef.current.setBounds(bounds);
            hoverHighlightRef.current.setStyle({ fillColor, stroke: false, fillOpacity: 0.5 });
        } else {
            const highlight = L.rectangle(bounds, {
                fillColor,
                stroke: false,
                fillOpacity: 0.5,
                interactive: false,
            });
            highlight.addTo(mapRef.current);
            hoverHighlightRef.current = highlight;
        }

        // Calculate crosshair size based on zoom level
        const currentZoom = mapRef.current.getZoom();
        const minCrosshairSize = 32; // Minimum size when zoomed out
        
        let crosshairSize = minCrosshairSize;
        
        // After zoom 15, calculate exact pixel size from map projection
        if (currentZoom >= PIXEL_SELECT_ZOOM) {
            // Get screen coordinates of the pixel bounds
            const point1 = mapRef.current.latLngToContainerPoint([lat1, lon1]);
            const point2 = mapRef.current.latLngToContainerPoint([lat2, lon2]);
            // Use the larger dimension (should be same for square pixels)
            const pixelScreenSize = Math.max(
                Math.abs(point2.x - point1.x),
                Math.abs(point2.y - point1.y)
            );
            crosshairSize = pixelScreenSize;
        }

        // Update or create crosshair marker for hover
        const crosshairIcon = L.divIcon({
            html: `<div style="color: ${crosshairColor}; width: 100%; height: 100%; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3)); opacity: 0.8;">${CROSSHAIR_SVG}</div>`,
            className: 'crosshair-marker',
            iconSize: [crosshairSize, crosshairSize],
            iconAnchor: [crosshairSize / 2, crosshairSize / 2],
        });

        if (hoverCrosshairRef.current) {
            hoverCrosshairRef.current.setLatLng([centerLat, centerLon]);
            hoverCrosshairRef.current.setIcon(crosshairIcon);
        } else {
            const crosshair = L.marker([centerLat, centerLon], {
                icon: crosshairIcon,
                interactive: false,
            });
            crosshair.addTo(mapRef.current);
            hoverCrosshairRef.current = crosshair;
        }
    }, []);

    // Handle map hover out
    const handleMapHoverOut = useCallback(() => {
        setState((prev) => ({ ...prev, hoveredPixel: null }));

        if (hoverHighlightRef.current && mapRef.current) {
            mapRef.current.removeLayer(hoverHighlightRef.current);
            hoverHighlightRef.current = null;
        }
        if (hoverCrosshairRef.current && mapRef.current) {
            mapRef.current.removeLayer(hoverCrosshairRef.current);
            hoverCrosshairRef.current = null;
        }
    }, []);

    // Handle map click
    const handleMapClick = useCallback((lat: number, lng: number, selectedColor?: string) => {
        const { px, py } = latLonToGlobalPx(lat, lng);
        setState((prev) => ({ ...prev, selectedPixel: { px, py } }));

        if (!mapRef.current) return;

        const currentZoom = mapRef.current.getZoom();
        const needsZoom = currentZoom < PIXEL_SELECT_ZOOM;

        if (needsZoom) {
            if (selectedHighlightRef.current) {
                mapRef.current.removeLayer(selectedHighlightRef.current);
                selectedHighlightRef.current = null;
            }

            // Calculate offset to account for bottom panel
            const bottomPanelOffset = 120;
            const degreesPerPixel = 360 / (256 * Math.pow(2, PIXEL_SELECT_ZOOM));
            const latOffset = bottomPanelOffset * degreesPerPixel;

            mapRef.current.flyTo([lat - latOffset, lng], PIXEL_SELECT_ZOOM, {
                duration: 0.8,
                easeLinearity: 0.25,
            });

            const onMoveEnd = () => {
                showSelectionHighlight(px, py, selectedColor);
                mapRef.current?.off('moveend', onMoveEnd);
            };
            mapRef.current.on('moveend', onMoveEnd);
        } else {
            showSelectionHighlight(px, py, selectedColor);
        }
    }, [showSelectionHighlight]);

    // Get selected pixel color
    const getSelectedPixelColor = useCallback(() => {
        if (!state.selectedPixel) return null;
        const pixelKey = `${state.selectedPixel.px},${state.selectedPixel.py}`;
        return pixelDataRef.current.get(pixelKey) || null;
    }, [state.selectedPixel]);

    // Update selected highlight color
    const updateSelectedHighlightColor = useCallback((newColor: string) => {
        if (!selectedHighlightRef.current || !state.selectedPixel) return;

        const hex = newColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;

        selectedHighlightRef.current.setStyle({
            fillColor,
            stroke: false,
            fillOpacity: 0.5,
        });
    }, [state.selectedPixel]);

    // Bulk update markers (for efficient loading)
    const bulkUpdateMarkers = useCallback((pixels: PixelData[]) => {
        if (!mapRef.current) return;

        // Process in batches to avoid locking UI
        const BATCH_SIZE = 1000;
        
        for (let i = 0; i < pixels.length; i += BATCH_SIZE) {
            const batch = pixels.slice(i, i + BATCH_SIZE);
            
            batch.forEach(({ px, py, color, timestamp }) => {
                const pixelKey = `${px},${py}`;
                pixelDataRef.current.set(pixelKey, color);
                
                // Update or create marker
                updateMarkerInternal(px, py, color);
            });
        }
        
        setPlacedPixelCount(pixelDataRef.current.size);
        
        // Merge into localPixels, respecting max size and uniqueness
        setLocalPixels(prev => {
            const newMap = new Map(prev.map(p => [`${p.px},${p.py}`, p]));
            
            pixels.forEach(p => {
                // Only add to recent list if it has a valid timestamp
                if (p.timestamp > 0) {
                    newMap.set(`${p.px},${p.py}`, p);
                }
            });

            return Array.from(newMap.values())
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 50);
        });
    }, [updateMarkerInternal]);

    return {
        mapRef,
        selectedPixel: state.selectedPixel,
        hoveredPixel: state.hoveredPixel,
        placedPixelCount,
        localPixels,
        focusOnPixel,
        handleMapClick,
        handleMapHover,
        handleMapHoverOut,
        getSelectedPixelColor,
        updateSelectedHighlightColor,
        initializeMap,
        // Exposed for local updates
        updateMarker,
        removeMarker,
        bulkUpdateMarkers,
    };
}
