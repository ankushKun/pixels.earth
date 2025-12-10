import { useEffect, useRef, useState } from 'react';
import { useMap as useLeafletMap } from 'react-leaflet';
import * as L from 'leaflet';
import { SHARD_DIMENSION, SHARDS_PER_DIM, CANVAS_RES } from '../constants';
import { globalPxToLatLon } from '../lib/projection';
import lockedTexture from '../assets/locked.jpg';

interface ShardGridOverlayProps {
    visible: boolean;
    onAggregatedChange?: (isAggregated: boolean) => void;
    onVisibleShardsChange?: (shards: { x: number; y: number }[]) => void;
    alertShard?: { x: number; y: number } | null;
    unlockedShards?: Set<string>;
    onUnlockShard?: (shardX: number, shardY: number) => void;
    highlightShard?: { x: number; y: number } | null;
}

/**
 * Renders a visual overlay showing the shard grid boundaries on the map.
 * Each shard is 128×128 pixels, with 2048 shards per dimension.
 * Hover detection (locked texture + icon) always works when zoomed in.
 * Grid lines/labels only show when visible=true.
 */
export function ShardGridOverlay({ visible, onAggregatedChange, onVisibleShardsChange, alertShard, unlockedShards, onUnlockShard, highlightShard }: ShardGridOverlayProps) {
    const map = useLeafletMap();
    const gridLayerRef = useRef<L.LayerGroup | null>(null);
    const labelsLayerRef = useRef<L.LayerGroup | null>(null);
    const hoverDetectionLayerRef = useRef<L.LayerGroup | null>(null);
    const hoverEffectLayerRef = useRef<L.LayerGroup | null>(null);
    const alertLayerRef = useRef<L.LayerGroup | null>(null);
    const highlightLayerRef = useRef<L.LayerGroup | null>(null);
    const [visibleShards, setVisibleShards] = useState<{ x: number; y: number }[]>([]);

    // Create all layers once
    useEffect(() => {
        if (!gridLayerRef.current) {
            gridLayerRef.current = L.layerGroup();
        }
        if (!labelsLayerRef.current) {
            labelsLayerRef.current = L.layerGroup();
        }
        if (!hoverDetectionLayerRef.current) {
            hoverDetectionLayerRef.current = L.layerGroup();
        }
        if (!hoverEffectLayerRef.current) {
            hoverEffectLayerRef.current = L.layerGroup();
        }
        if (!alertLayerRef.current) {
            alertLayerRef.current = L.layerGroup();
        }

        // Hover detection and effects are always added to map
        hoverDetectionLayerRef.current.addTo(map);
        hoverEffectLayerRef.current.addTo(map);
        alertLayerRef.current.addTo(map);

        return () => {
            if (gridLayerRef.current) {
                gridLayerRef.current.clearLayers();
                map.removeLayer(gridLayerRef.current);
            }
            if (labelsLayerRef.current) {
                labelsLayerRef.current.clearLayers();
                map.removeLayer(labelsLayerRef.current);
            }
            if (hoverDetectionLayerRef.current) {
                hoverDetectionLayerRef.current.clearLayers();
                map.removeLayer(hoverDetectionLayerRef.current);
            }
            if (hoverEffectLayerRef.current) {
                hoverEffectLayerRef.current.clearLayers();
                map.removeLayer(hoverEffectLayerRef.current);
            }
            if (alertLayerRef.current) {
                alertLayerRef.current.clearLayers();
                map.removeLayer(alertLayerRef.current);
            }
            if (highlightLayerRef.current) {
                highlightLayerRef.current.clearLayers();
                map.removeLayer(highlightLayerRef.current);
            }
        };
    }, [map]);

    // Initialize highlight layer on mount with high z-index pane
    useEffect(() => {
        // Create a custom pane with high z-index for highlights
        if (!map.getPane('highlightPane')) {
            const pane = map.createPane('highlightPane');
            pane.style.zIndex = '700'; // Very high z-index, above most elements
        }

        if (!highlightLayerRef.current) {
            highlightLayerRef.current = L.layerGroup();
            highlightLayerRef.current.addTo(map);
        }
    }, [map]);

    // Handle highlight shard animation (glow effect when focusing on a shard from Recent Shards)
    useEffect(() => {
        if (!highlightShard) return;

        // Ensure pane exists
        if (!map.getPane('highlightPane')) {
            const pane = map.createPane('highlightPane');
            pane.style.zIndex = '700';
        }

        // Ensure layer exists
        if (!highlightLayerRef.current) {
            highlightLayerRef.current = L.layerGroup();
            highlightLayerRef.current.addTo(map);
        }

        const { x: shardX, y: shardY } = highlightShard;

        // Calculate shard bounds
        const px1 = shardX * SHARD_DIMENSION;
        const py1 = shardY * SHARD_DIMENSION;
        const px2 = (shardX + 1) * SHARD_DIMENSION;
        const py2 = (shardY + 1) * SHARD_DIMENSION;

        const { lat: lat1, lon: lon1 } = globalPxToLatLon(px1, py1);
        const { lat: lat2, lon: lon2 } = globalPxToLatLon(px2, py2);

        const shardBounds: L.LatLngBoundsExpression = [
            [Math.min(lat1, lat2), Math.min(lon1, lon2)],
            [Math.max(lat1, lat2), Math.max(lon1, lon2)],
        ];

        // Clear any existing highlight
        highlightLayerRef.current.clearLayers();

        // Create glowing border rectangle - very visible, in high z-index pane
        const highlightRect = L.rectangle(shardBounds, {
            color: '#10b981', // emerald-500
            weight: 6,
            opacity: 1,
            fillColor: '#10b981',
            fillOpacity: 0.25,
            interactive: false,
            pane: 'highlightPane',
        });
        highlightLayerRef.current.addLayer(highlightRect);

        // Animate opacity fade out over 1.5 seconds
        let opacity = 1;
        let fillOpacity = 0.25;
        const fadeInterval = setInterval(() => {
            opacity -= 0.033;
            fillOpacity -= 0.008;
            if (opacity <= 0) {
                clearInterval(fadeInterval);
                if (highlightLayerRef.current) {
                    highlightLayerRef.current.clearLayers();
                }
            } else {
                highlightRect.setStyle({ opacity, fillOpacity: Math.max(0, fillOpacity) });
            }
        }, 50);

        return () => {
            clearInterval(fadeInterval);
            if (highlightLayerRef.current) {
                highlightLayerRef.current.clearLayers();
            }
        };
    }, [highlightShard, map]);

    // Handle alert shard animation (pulse effect when clicking locked shard at zoom 13)
    useEffect(() => {
        if (!alertShard || !alertLayerRef.current) return;

        const { x: shardX, y: shardY } = alertShard;

        // Calculate shard bounds
        const px1 = shardX * SHARD_DIMENSION;
        const py1 = shardY * SHARD_DIMENSION;
        const px2 = (shardX + 1) * SHARD_DIMENSION;
        const py2 = (shardY + 1) * SHARD_DIMENSION;

        const { lat: lat1, lon: lon1 } = globalPxToLatLon(px1, py1);
        const { lat: lat2, lon: lon2 } = globalPxToLatLon(px2, py2);

        const shardBounds: L.LatLngBoundsExpression = [
            [Math.min(lat1, lat2), Math.min(lon1, lon2)],
            [Math.max(lat1, lat2), Math.max(lon1, lon2)],
        ];

        // Create pulsing overlay
        const alertOverlay = L.imageOverlay(lockedTexture, shardBounds, {
            opacity: 0.6,
            interactive: false,
            className: 'locked-alert-overlay',
        });
        alertLayerRef.current.addLayer(alertOverlay);

        // Add lock icon
        const centerLat = (lat1 + lat2) / 2;
        const centerLon = (lon1 + lon2) / 2;

        const lockIcon = L.divIcon({
            html: `<div class="lock-alert-icon" style="
                display: flex;
                align-items: center;
                justify-content: center;
                width: 64px;
                height: 64px;
                background: rgba(220, 38, 38, 0.9);
                border-radius: 50%;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                animation: pulse-scale 0.3s ease-in-out 2;
            ">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
            </div>`,
            className: 'lock-alert-container',
            iconSize: [64, 64],
            iconAnchor: [32, 32],
        });

        const lockMarker = L.marker([centerLat, centerLon], {
            icon: lockIcon,
            interactive: false,
        });
        alertLayerRef.current.addLayer(lockMarker);

        // Animate opacity pulse
        let opacity = 0.6;
        let increasing = false;
        const pulseInterval = setInterval(() => {
            if (increasing) {
                opacity += 0.1;
                if (opacity >= 0.6) increasing = false;
            } else {
                opacity -= 0.1;
                if (opacity <= 0.2) increasing = true;
            }
            alertOverlay.setOpacity(opacity);
        }, 50);

        // Cleanup after animation
        const cleanup = () => {
            clearInterval(pulseInterval);
            if (alertLayerRef.current) {
                alertLayerRef.current.clearLayers();
            }
        };

        // Auto-cleanup after 600ms
        const timeout = setTimeout(cleanup, 600);

        return () => {
            clearTimeout(timeout);
            cleanup();
        };
    }, [alertShard, map]);

    // Toggle grid visibility (lines and labels only)
    useEffect(() => {
        if (!gridLayerRef.current || !labelsLayerRef.current) return;

        if (visible) {
            gridLayerRef.current.addTo(map);
            labelsLayerRef.current.addTo(map);
        } else {
            map.removeLayer(gridLayerRef.current);
            map.removeLayer(labelsLayerRef.current);
        }
    }, [visible, map]);

    // Global click handler for unlock buttons
    useEffect(() => {
        const handleUnlockClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const button = target.closest('.unlock-shard-btn') as HTMLElement;
            if (button && onUnlockShard) {
                e.stopPropagation();
                e.preventDefault();
                const shardX = parseInt(button.dataset.shardX || '0', 10);
                const shardY = parseInt(button.dataset.shardY || '0', 10);
                onUnlockShard(shardX, shardY);
            }
        };

        document.addEventListener('click', handleUnlockClick, true);
        return () => {
            document.removeEventListener('click', handleUnlockClick, true);
        };
    }, [onUnlockShard]);

    // Update hover detection zones based on map view (always active)
    useEffect(() => {
        const updateHoverZones = () => {
            if (!hoverDetectionLayerRef.current || !hoverEffectLayerRef.current) return;

            const bounds = map.getBounds();
            const zoom = map.getZoom();

            // Clear existing layers
            hoverDetectionLayerRef.current.clearLayers();
            hoverEffectLayerRef.current.clearLayers();

            // Only create hover zones when zoomed in enough
            const isZoomedInEnough = zoom >= 10;
            
            // Notify parent about aggregation state
            onAggregatedChange?.(!isZoomedInEnough);
            
            if (!isZoomedInEnough) {
                setVisibleShards([]);
                onVisibleShardsChange?.([]);
                return;
            }

            // Convert bounds to pixel coordinates
            const nw = bounds.getNorthWest();
            const se = bounds.getSouthEast();

            const pxNW = latLonToShardCoords(nw.lat, nw.lng);
            const pxSE = latLonToShardCoords(se.lat, se.lng);

            const minShardX = Math.max(0, Math.floor(pxNW.shardX));
            const maxShardX = Math.min(SHARDS_PER_DIM - 1, Math.ceil(pxSE.shardX));
            const minShardY = Math.max(0, Math.floor(pxNW.shardY));
            const maxShardY = Math.min(SHARDS_PER_DIM - 1, Math.ceil(pxSE.shardY));

            const newVisibleShards: { x: number; y: number }[] = [];

            // Create invisible hover detection rectangles for each shard
            for (let sy = minShardY; sy <= maxShardY; sy++) {
                for (let sx = minShardX; sx <= maxShardX; sx++) {
                    newVisibleShards.push({ x: sx, y: sy });

                    const px1 = sx * SHARD_DIMENSION;
                    const py1 = sy * SHARD_DIMENSION;
                    const px2 = Math.min((sx + 1) * SHARD_DIMENSION, CANVAS_RES);
                    const py2 = Math.min((sy + 1) * SHARD_DIMENSION, CANVAS_RES);

                    const { lat: lat1, lon: lon1 } = globalPxToLatLon(px1, py1);
                    const { lat: lat2, lon: lon2 } = globalPxToLatLon(px2, py2);

                    const shardBounds: L.LatLngBoundsExpression = [
                        [Math.min(lat1, lat2), Math.min(lon1, lon2)],
                        [Math.max(lat1, lat2), Math.max(lon1, lon2)],
                    ];

                    // Invisible hover detection rectangle
                    const hoverRect = L.rectangle(shardBounds, {
                        color: 'transparent',
                        weight: 0,
                        opacity: 0,
                        fillColor: 'transparent',
                        fillOpacity: 0,
                        interactive: true,
                    });

                    // Hover handlers
                    let hoverOverlay: L.ImageOverlay | null = null;
                    let lockMarker: L.Marker | null = null;
                    let unlockButtonMarker: L.Marker | null = null;

                    // Check if this shard is unlocked
                    const shardKey = `${sx},${sy}`;
                    const isUnlocked = unlockedShards?.has(shardKey) ?? false;

                    hoverRect.on('mouseover', () => {
                        if (!hoverEffectLayerRef.current) return;
                        
                        // Don't show locked overlay for unlocked shards
                        if (isUnlocked) return;

                        // Create locked texture overlay with 20% opacity
                        hoverOverlay = L.imageOverlay(lockedTexture, shardBounds, {
                            opacity: 0.2,
                            interactive: false,
                            className: 'locked-texture-overlay',
                        });
                        hoverEffectLayerRef.current.addLayer(hoverOverlay);

                        // Add lock icon in center
                        const centerLat = (lat1 + lat2) / 2;
                        const centerLon = (lon1 + lon2) / 2;

                        const lockIcon = L.divIcon({
                            html: `<div style="
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                width: 48px;
                                height: 48px;
                                background: rgba(0, 0, 0, 0.7);
                                border-radius: 50%;
                                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                            ">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                            </div>`,
                            className: 'lock-icon-container',
                            iconSize: [48, 48],
                            iconAnchor: [24, 24],
                        });

                        lockMarker = L.marker([centerLat, centerLon], {
                            icon: lockIcon,
                            interactive: false,
                        });
                        hoverEffectLayerRef.current.addLayer(lockMarker);

                        // Add unlock button below the lock icon
                        const unlockButtonIcon = L.divIcon({
                            html: `<button class="unlock-shard-btn" data-shard-x="${sx}" data-shard-y="${sy}" style="
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                gap: 6px;
                                padding: 8px 16px;
                                background: linear-gradient(135deg, #10b981, #059669);
                                color: white;
                                border: none;
                                border-radius: 8px;
                                font-size: 13px;
                                font-weight: 600;
                                cursor: pointer;
                                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
                                transition: transform 0.15s, box-shadow 0.15s;
                                white-space: nowrap;
                            " onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 6px 16px rgba(16, 185, 129, 0.5)';"
                               onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 12px rgba(16, 185, 129, 0.4)';">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                                </svg>
                                Unlock Shard
                            </button>`,
                            className: 'unlock-button-container',
                            iconSize: [140, 36],
                            iconAnchor: [70, -30],
                        });

                        unlockButtonMarker = L.marker([centerLat, centerLon], {
                            icon: unlockButtonIcon,
                            interactive: true,
                        });
                        hoverEffectLayerRef.current.addLayer(unlockButtonMarker);
                    });

                    hoverRect.on('mouseout', () => {
                        if (hoverOverlay && hoverEffectLayerRef.current) {
                            hoverEffectLayerRef.current.removeLayer(hoverOverlay);
                            hoverOverlay = null;
                        }
                        if (lockMarker && hoverEffectLayerRef.current) {
                            hoverEffectLayerRef.current.removeLayer(lockMarker);
                            lockMarker = null;
                        }
                        if (unlockButtonMarker && hoverEffectLayerRef.current) {
                            hoverEffectLayerRef.current.removeLayer(unlockButtonMarker);
                            unlockButtonMarker = null;
                        }
                    });

                    hoverDetectionLayerRef.current!.addLayer(hoverRect);
                }
            }

            setVisibleShards(newVisibleShards);
            onVisibleShardsChange?.(newVisibleShards);
        };

        // Initial update
        updateHoverZones();

        // Update on map move/zoom
        map.on('moveend', updateHoverZones);
        map.on('zoomend', updateHoverZones);

        return () => {
            map.off('moveend', updateHoverZones);
            map.off('zoomend', updateHoverZones);
        };
    }, [map, onAggregatedChange, onVisibleShardsChange, unlockedShards]);

    // Update visible grid lines and labels (only when visible=true)
    useEffect(() => {
        if (!visible) return;
        if (!gridLayerRef.current || !labelsLayerRef.current) return;

        const updateGrid = () => {
            if (!gridLayerRef.current || !labelsLayerRef.current) return;

            const bounds = map.getBounds();
            const zoom = map.getZoom();

            // Clear existing layers
            gridLayerRef.current.clearLayers();
            labelsLayerRef.current.clearLayers();

            // Only show grid when zoomed in enough
            const isZoomedInEnough = zoom >= 10;
            if (!isZoomedInEnough) return;

            const nw = bounds.getNorthWest();
            const se = bounds.getSouthEast();

            const pxNW = latLonToShardCoords(nw.lat, nw.lng);
            const pxSE = latLonToShardCoords(se.lat, se.lng);

            const minShardX = Math.max(0, Math.floor(pxNW.shardX));
            const maxShardX = Math.min(SHARDS_PER_DIM - 1, Math.ceil(pxSE.shardX));
            const minShardY = Math.max(0, Math.floor(pxNW.shardY));
            const maxShardY = Math.min(SHARDS_PER_DIM - 1, Math.ceil(pxSE.shardY));

            // Draw shard boundaries and labels
            for (let sy = minShardY; sy <= maxShardY; sy++) {
                for (let sx = minShardX; sx <= maxShardX; sx++) {
                    const px1 = sx * SHARD_DIMENSION;
                    const py1 = sy * SHARD_DIMENSION;
                    const px2 = Math.min((sx + 1) * SHARD_DIMENSION, CANVAS_RES);
                    const py2 = Math.min((sy + 1) * SHARD_DIMENSION, CANVAS_RES);

                    const { lat: lat1, lon: lon1 } = globalPxToLatLon(px1, py1);
                    const { lat: lat2, lon: lon2 } = globalPxToLatLon(px2, py2);

                    const shardBounds: L.LatLngBoundsExpression = [
                        [Math.min(lat1, lat2), Math.min(lon1, lon2)],
                        [Math.max(lat1, lat2), Math.max(lon1, lon2)],
                    ];

                    // Visible grid rectangle (non-interactive, visual only)
                    const rect = L.rectangle(shardBounds, {
                        color: '#3b82f6',
                        weight: 2,
                        opacity: 0.6,
                        fillColor: '#3b82f6',
                        fillOpacity: 0.05,
                        interactive: false,
                    });
                    gridLayerRef.current!.addLayer(rect);

                    // Add label
                    if (zoom >= 8) {
                        const centerLat = (lat1 + lat2) / 2;
                        const centerLon = (lon1 + lon2) / 2;

                        const label = L.divIcon({
                            html: `<div class="shard-label" style="
                                background: rgba(59, 130, 246, 0.9);
                                color: white;
                                padding: 2px 6px;
                                border-radius: 4px;
                                font-size: 10px;
                                font-weight: 600;
                                white-space: nowrap;
                                font-family: monospace;
                                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                            ">(${sx}, ${sy})</div>`,
                            className: 'shard-label-container',
                            iconSize: [60, 20],
                            iconAnchor: [30, 10],
                        });

                        const marker = L.marker([centerLat, centerLon], {
                            icon: label,
                            interactive: false,
                        });
                        labelsLayerRef.current!.addLayer(marker);
                    }
                }
            }
        };

        // Initial update
        updateGrid();

        // Update on map move/zoom
        map.on('moveend', updateGrid);
        map.on('zoomend', updateGrid);

        return () => {
            map.off('moveend', updateGrid);
            map.off('zoomend', updateGrid);
        };
    }, [visible, map]);

    return null;
}

/**
 * Convert lat/lon to shard coordinates
 */
function latLonToShardCoords(lat: number, lon: number): { shardX: number; shardY: number } {
    // Use Mercator projection to get pixel coordinates
    const x = (lon + 180) / 360;
    const latRad = (lat * Math.PI) / 180;
    const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;

    const px = x * CANVAS_RES;
    const py = y * CANVAS_RES;

    return {
        shardX: px / SHARD_DIMENSION,
        shardY: py / SHARD_DIMENSION,
    };
}

export default ShardGridOverlay;
