import { useEffect, useRef, useState, useCallback } from 'react';
import { useMap as useLeafletMap } from 'react-leaflet';
import * as L from 'leaflet';
import { SHARD_DIMENSION, SHARDS_PER_DIM, CANVAS_RES } from '../constants';
import { globalPxToLatLon } from '../lib/projection';
import lockedTexture from '../assets/locked.jpg';


interface UnlockingShardState {
    x: number;
    y: number;
    status: string;
}

interface ShardGridOverlayProps {
    visible: boolean;
    onAggregatedChange?: (isAggregated: boolean) => void;
    onVisibleShardsChange?: (shards: { x: number; y: number }[]) => void;
    alertShard?: { x: number; y: number } | null;
    unlockedShards?: Set<string>;
    onUnlockShard?: (shardX: number, shardY: number) => void;
    highlightShard?: { x: number; y: number } | null;
    hideLockedOverlay?: boolean;
    unlockingShard?: UnlockingShardState | null;
    shardMetadata?: Map<string, { creator: string, pixelCount: number }>;
    currentUserPublicKey?: string;
}

/**
 * Renders a visual overlay showing the shard grid boundaries on the map.
 * Each shard is 90×90 pixels.
 * Improved Implementation: Uses global tracking for performant, jitter-free hover effects.
 */
export function ShardGridOverlay({ visible, onAggregatedChange, onVisibleShardsChange, alertShard, unlockedShards, onUnlockShard, highlightShard, hideLockedOverlay, unlockingShard, shardMetadata, currentUserPublicKey }: ShardGridOverlayProps) {
    const map = useLeafletMap();
    const gridLayerRef = useRef<L.LayerGroup | null>(null);
    const labelsLayerRef = useRef<L.LayerGroup | null>(null);
    const hoverEffectLayerRef = useRef<L.LayerGroup | null>(null);
    const alertLayerRef = useRef<L.LayerGroup | null>(null);
    const highlightLayerRef = useRef<L.LayerGroup | null>(null);
    const activeHoverShardRef = useRef<{ x: number, y: number } | null>(null);
    const [visibleShards, setVisibleShards] = useState<{ x: number; y: number }[]>([]);

    // Create all layers once
    useEffect(() => {
        if (!gridLayerRef.current) gridLayerRef.current = L.layerGroup();
        if (!labelsLayerRef.current) labelsLayerRef.current = L.layerGroup();
        if (!hoverEffectLayerRef.current) hoverEffectLayerRef.current = L.layerGroup();
        if (!alertLayerRef.current) alertLayerRef.current = L.layerGroup();
        if (!highlightLayerRef.current) highlightLayerRef.current = L.layerGroup();

        // Create panes
        if (!map.getPane('hoverPane')) {
            const pane = map.createPane('hoverPane');
            pane.style.zIndex = '650'; // Above map, below highlights
        }
        if (!map.getPane('highlightPane')) {
            const pane = map.createPane('highlightPane');
            pane.style.zIndex = '700';
        }

        // Add layers to map
        hoverEffectLayerRef.current.addTo(map);
        alertLayerRef.current.addTo(map);

        return () => {
             const layers = [
                gridLayerRef, labelsLayerRef, 
                hoverEffectLayerRef, alertLayerRef, highlightLayerRef
            ];
            
            layers.forEach(ref => {
                if (ref.current) {
                    ref.current.clearLayers();
                    map.removeLayer(ref.current);
                }
            });
        };
    }, [map]);



    // Handle highlight shard animation
    useEffect(() => {
        if (!highlightShard || !highlightLayerRef.current) return;
        
        // Ensure layer is on map
        if (!map.hasLayer(highlightLayerRef.current)) {
            highlightLayerRef.current.addTo(map);
        }

        const { x: shardX, y: shardY } = highlightShard;

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

        highlightLayerRef.current.clearLayers();

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
            if (highlightLayerRef.current) highlightLayerRef.current.clearLayers();
        };
    }, [highlightShard, map]);

    // Handle alert shard animation
    useEffect(() => {
        if (!alertShard || !alertLayerRef.current) return;

        const { x: shardX, y: shardY } = alertShard;

        const px1 = shardX * SHARD_DIMENSION;
        const py1 = shardY * SHARD_DIMENSION;
        const px2 = (shardX + 1) * SHARD_DIMENSION;
        const py2 = (shardY + 1) * SHARD_DIMENSION;

        const { lat: lat1, lon: lon1 } = globalPxToLatLon(px1, py1);
        const { lat: lat2, lon: lon2 } = globalPxToLatLon(px2, py2);
        
        const centerLat = (lat1 + lat2) / 2;
        const centerLon = (lon1 + lon2) / 2;

        const shardBounds: L.LatLngBoundsExpression = [
            [Math.min(lat1, lat2), Math.min(lon1, lon2)],
            [Math.max(lat1, lat2), Math.max(lon1, lon2)],
        ];

        // Red overlay
        const alertOverlay = L.rectangle(shardBounds, {
            color: '#ef4444',
            weight: 2,
            opacity: 0,
            fillColor: '#ef4444',
            fillOpacity: 0.4,
            interactive: false,
            className: 'alert-pulse-overlay'
        });
        alertLayerRef.current.addLayer(alertOverlay);



        // Pulse Animation
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
            alertOverlay.setStyle({ fillOpacity: opacity });
        }, 50);

        const timeout = setTimeout(() => {
            clearInterval(pulseInterval);
            if (alertLayerRef.current) alertLayerRef.current.clearLayers();
        }, 600);

        return () => {
            clearTimeout(timeout);
            clearInterval(pulseInterval);
            if (alertLayerRef.current) alertLayerRef.current.clearLayers();
        };
    }, [alertShard, map]);

    // Grid Visibility
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

    // Handle visible shards & grid lines - optimized to only run when grid is visible or for visibility reporting
    useEffect(() => {
        const updateGridAndVisibility = () => {
            const bounds = map.getBounds();
            const zoom = map.getZoom();
            
            // Only relevant when zoomed in
            const isZoomedInEnough = zoom >= 12;
            onAggregatedChange?.(!isZoomedInEnough);
            
            if (!isZoomedInEnough) {
                setVisibleShards([]);
                onVisibleShardsChange?.([]);
                if (gridLayerRef.current) gridLayerRef.current.clearLayers();
                if (labelsLayerRef.current) labelsLayerRef.current.clearLayers();
                return;
            }

            const nw = bounds.getNorthWest();
            const se = bounds.getSouthEast();

            const pxNW = latLonToShardCoords(nw.lat, nw.lng);
            const pxSE = latLonToShardCoords(se.lat, se.lng);

            const minShardX = Math.max(0, Math.floor(pxNW.shardX));
            const maxShardX = Math.min(SHARDS_PER_DIM - 1, Math.ceil(pxSE.shardX));
            const minShardY = Math.max(0, Math.floor(pxNW.shardY));
            const maxShardY = Math.min(SHARDS_PER_DIM - 1, Math.ceil(pxSE.shardY));

            const newVisibleShards: { x: number; y: number }[] = [];

            // If grid lines are visible, we need to draw them
            const showGridLines = visible && gridLayerRef.current && labelsLayerRef.current;
            if (showGridLines) {
                gridLayerRef.current!.clearLayers();
                labelsLayerRef.current!.clearLayers();
            }

            for (let sy = minShardY; sy <= maxShardY; sy++) {
                for (let sx = minShardX; sx <= maxShardX; sx++) {
                    newVisibleShards.push({ x: sx, y: sy });

                    if (showGridLines) {
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

                        const rect = L.rectangle(shardBounds, {
                            color: '#3b82f6',
                            weight: 1,
                            opacity: 0.4,
                            fillColor: '#3b82f6',
                            fillOpacity: 0.02,
                            interactive: false,
                        });
                        gridLayerRef.current!.addLayer(rect);

                        if (zoom >= 12) {
                             const centerLat = (lat1 + lat2) / 2;
                             const centerLon = (lon1 + lon2) / 2;
                             const metadata = shardMetadata?.get(`${sx},${sy}`);
                             const isLocked = !unlockedShards?.has(`${sx},${sy}`);

                             let contentHtml = '';
                             if (isLocked) {
                                  // Minimal Locked Label
                                  contentHtml = `
                                     <div class="px-2 py-1 bg-zinc-950/40 backdrop-blur-sm rounded border border-white/5 text-[10px] text-white/40 font-mono shadow-sm hover:bg-zinc-900/60 transition-colors cursor-default">
                                         <div class="flex items-center gap-1.5 opacity-60">
                                             <span class="font-bold tracking-tight">(${sx}, ${sy})</span>
                                             <span class="w-px h-3 bg-white/10"></span>
                                             <span>LOCKED</span>
                                         </div>
                                     </div>
                                  `;
                             } else if (metadata) {
                                 // Detailed Active Card
                                 const isOwner = currentUserPublicKey && metadata.creator === currentUserPublicKey;
                                 const shortOwner = metadata.creator.slice(0, 4) + '...' + metadata.creator.slice(-4);
                                 
                                 const bgClass = isOwner 
                                     ? "bg-emerald-900/80 hover:bg-emerald-900/90 border-emerald-500/30 hover:border-emerald-400/50" 
                                     : "bg-zinc-900/75 hover:bg-zinc-800/80 border-white/10 hover:border-white/20";
                                     
                                 contentHtml = `
                                     <div class="flex flex-col gap-0.5 px-2.5 py-2 ${bgClass} backdrop-blur-md rounded-lg border shadow-xl min-w-[110px] transition-all cursor-default group">
                                         <div class="flex items-center justify-between text-[11px] text-white/90 font-bold tracking-tight border-b border-white/10 pb-1 mb-1 group-hover:border-white/20">
                                             <span>(${sx}, ${sy})</span>
                                             <span class="${isOwner ? 'text-emerald-300' : 'text-emerald-400'} text-[9px] px-1 py-px ${isOwner ? 'bg-emerald-500/30' : 'bg-emerald-500/10'} rounded">ACTIVE</span>
                                         </div>
                                         <div class="flex items-center justify-between text-[10px] text-zinc-400">
                                             <span class="${isOwner ? 'text-emerald-200/70' : ''}">Owner</span>
                                             <span class="font-mono ${isOwner ? 'text-emerald-100 bg-emerald-950/50' : 'text-zinc-300 bg-black/20'} ml-2 px-1 rounded">${isOwner ? 'YOU' : shortOwner}</span>
                                         </div>
                                         <div class="flex items-center justify-between text-[10px] text-zinc-400">
                                             <span class="${isOwner ? 'text-emerald-200/70' : ''}">Pixels</span>
                                             <span class="font-mono ${isOwner ? 'text-emerald-100' : 'text-zinc-300'} ml-2">${metadata.pixelCount}</span>
                                         </div>
                                     </div>
                                 `;
                             } else {
                                  // Active but loading/unknown
                                  contentHtml = `
                                     <div class="px-2 py-1 bg-zinc-900/60 backdrop-blur-md rounded border border-white/10 text-[10px] text-white/70 font-mono shadow-sm">
                                         <div class="flex items-center gap-1.5">
                                             <span class="font-bold tracking-tight">(${sx}, ${sy})</span>
                                             <span class="w-px h-3 bg-white/20"></span>
                                             <span>ACTIVE</span>
                                         </div>
                                     </div>
                                  `;
                             }

                             const label = L.divIcon({
                                html: contentHtml,
                                className: 'flex items-center justify-center pointer-events-auto', // Pointer events auto to allow hover effects on card? actually map handles clicks usually.
                                iconSize: [140, 80],
                            });
                            labelsLayerRef.current!.addLayer(L.marker([centerLat, centerLon], { icon: label, interactive: false }));
                        }
                    }
                }
            }
            
            setVisibleShards(newVisibleShards);
            onVisibleShardsChange?.(newVisibleShards);
        };

        map.on('moveend', updateGridAndVisibility);
        map.on('zoomend', updateGridAndVisibility);
        
        // Call immediately - this runs on mount AND when dependencies change
        // This ensures grid labels update when shardMetadata or unlockedShards change
        updateGridAndVisibility();

        return () => {
            map.off('moveend', updateGridAndVisibility);
            map.off('zoomend', updateGridAndVisibility);
        };
    }, [map, visible, onAggregatedChange, onVisibleShardsChange, unlockedShards, shardMetadata, currentUserPublicKey]);

    // Refs for stable state access without restarting effects
    const activeOverlayRef = useRef<L.ImageOverlay | null>(null);
    const activeMarkerRef = useRef<L.Marker | null>(null);
    const unlockedShardsRef = useRef(unlockedShards);
    const unlockingShardRef = useRef(unlockingShard);
    const isDraggingRef = useRef(false);

    // Keep refs in sync
    useEffect(() => { unlockedShardsRef.current = unlockedShards; }, [unlockedShards]);
    useEffect(() => { unlockingShardRef.current = unlockingShard; }, [unlockingShard]);

    // Clear helper
    const clearHover = useCallback(() => {
        if (activeHoverShardRef.current) {
            if (activeOverlayRef.current) activeOverlayRef.current.remove();
            if (activeMarkerRef.current) activeMarkerRef.current.remove();
            activeOverlayRef.current = null;
            activeMarkerRef.current = null;
            activeHoverShardRef.current = null;
        }
    }, []);

    // Update overlay logic
    const updateOverlay = useCallback((sx: number, sy: number) => {
        if (!hoverEffectLayerRef.current) return;

        const shardKey = `${sx},${sy}`;
        const isUnlocked = unlockedShardsRef.current?.has(shardKey) ?? false;
        const isUnlocking = unlockingShardRef.current?.x === sx && unlockingShardRef.current?.y === sy;
        const shouldShowOverlay = (!isUnlocked || isUnlocking) && !hideLockedOverlay;

        if (!shouldShowOverlay) {
             if (activeHoverShardRef.current?.x === sx && activeHoverShardRef.current?.y === sy) {
                 clearHover();
             }
             return;
        }

        activeHoverShardRef.current = { x: sx, y: sy };

        const px1 = sx * SHARD_DIMENSION;
        const py1 = sy * SHARD_DIMENSION;
        const px2 = (sx + 1) * SHARD_DIMENSION;
        const py2 = (sy + 1) * SHARD_DIMENSION;

        const { lat: lat1, lon: lon1 } = globalPxToLatLon(px1, py1);
        const { lat: lat2, lon: lon2 } = globalPxToLatLon(px2, py2);
        const centerLat = (lat1 + lat2) / 2;
        const centerLon = (lon1 + lon2) / 2;

        const shardBounds: L.LatLngBoundsExpression = [
           [Math.min(lat1, lat2), Math.min(lon1, lon2)],
           [Math.max(lat1, lat2), Math.max(lon1, lon2)]
        ];

        // Update or Create Background
        if (activeOverlayRef.current) {
            activeOverlayRef.current.setBounds(L.latLngBounds(shardBounds as L.LatLngBoundsLiteral));
            if (!hoverEffectLayerRef.current.hasLayer(activeOverlayRef.current)) {
                activeOverlayRef.current.addTo(hoverEffectLayerRef.current);
            }
        } else {
            activeOverlayRef.current = L.imageOverlay(lockedTexture, shardBounds, {
                opacity: 0.3, 
                interactive: false,
                pane: 'hoverPane',
                className: 'locked-shard-bg'
            });
            activeOverlayRef.current.addTo(hoverEffectLayerRef.current);
        }

        // Update or Create UI Marker
        const uiIcon = L.divIcon({
            html: `
               <div class="flex flex-col items-center justify-center gap-2 w-full h-full pointer-events-none transition-opacity duration-300">
                    <!-- Icon Area -->
                    <div class="text-white/80 drop-shadow-md">
                       ${isUnlocking ? `
                           <div class="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                       ` : `
                           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                               <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                               <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                           </svg>
                       `}
                    </div>
                    
                    <!-- Action Area -->
                    ${isUnlocking ? `
                        <div class="px-4 py-1.5 bg-zinc-900/60 text-white/80 text-[11px] font-bold rounded-full border border-white/10 backdrop-blur-sm">
                           UNLOCKING...
                        </div>
                    ` : `
                        <button class="unlock-shard-btn pointer-events-auto
                           px-4 py-1.5 bg-zinc-900/90 text-white text-[11px] font-bold rounded-full 
                           border border-white/20 hover:bg-zinc-800 hover:scale-105 active:scale-95 transition-all duration-200
                           shadow-xl backdrop-blur-sm flex items-center gap-1.5"
                           data-shard-x="${sx}" data-shard-y="${sy}">
                           <span>UNLOCK SHARD</span>
                        </button>
                    `}
               </div>
            `,
            className: 'flex items-center justify-center w-full h-full bg-transparent',
            iconSize: [200, 200], 
            iconAnchor: [100, 100],
            pane: 'hoverPane' 
        });

        if (activeMarkerRef.current) {
            activeMarkerRef.current.setLatLng([centerLat, centerLon]);
            activeMarkerRef.current.setIcon(uiIcon);
            if (!hoverEffectLayerRef.current.hasLayer(activeMarkerRef.current)) {
                activeMarkerRef.current.addTo(hoverEffectLayerRef.current);
            }
        } else {
            activeMarkerRef.current = L.marker([centerLat, centerLon], {
                icon: uiIcon,
                interactive: !isUnlocking // Only interactive if not unlocking
            });
            activeMarkerRef.current.addTo(hoverEffectLayerRef.current);
        }
    }, [hideLockedOverlay, clearHover]);

    // Trigger update on state change if lingering on a shard
    useEffect(() => {
        if (activeHoverShardRef.current) {
            updateOverlay(activeHoverShardRef.current.x, activeHoverShardRef.current.y);
        }
    }, [unlockedShards, unlockingShard, updateOverlay]);

    // HOVER LOGIC - Global tracking
    useEffect(() => {
        if (!hoverEffectLayerRef.current) return;
        
        const handleMouseMove = (e: L.LeafletMouseEvent) => {
            if (map.getZoom() < 12 || isDraggingRef.current) {
                clearHover();
                return;
            }

            const { lat, lng } = e.latlng;
            const { shardX, shardY } = latLonToShardCoords(lat, lng);
            
            const sx = Math.floor(shardX);
            const sy = Math.floor(shardY);

            // Check if valid shard
            if (sx < 0 || sx >= SHARDS_PER_DIM || sy < 0 || sy >= SHARDS_PER_DIM) {
               clearHover();
               return;
            }

            // Check if position changed
            const current = activeHoverShardRef.current;
            if (current && current.x === sx && current.y === sy) {
                return; // Still on same shard (state updates handled by other effect)
            }

            updateOverlay(sx, sy);
        };
        
        const onZoomStart = () => {
             clearHover();
        };

        map.on('mousemove', handleMouseMove);
        map.on('mouseout', clearHover);
        map.on('dragstart', () => { isDraggingRef.current = true; clearHover(); });
        map.on('dragend', () => { isDraggingRef.current = false; });
        map.on('zoomstart', onZoomStart);

        return () => {
            map.off('mousemove', handleMouseMove);
            map.off('mouseout', clearHover);
            map.off('dragstart');
            map.off('dragend');
            map.off('zoomstart', onZoomStart);
            clearHover();
        };

    }, [map, updateOverlay, clearHover]);

    // Click Handler for buttons (Global delegation)
    useEffect(() => {
        const handleUnlockClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const button = target.closest('.unlock-shard-btn') as HTMLElement;
            if (button && onUnlockShard) {
                e.preventDefault();
                e.stopPropagation(); // Stop propagation to map click
                
                // Add simple click feedback
                button.style.transform = "scale(0.95)";
                setTimeout(() => button.style.transform = "", 150);

                const shardX = parseInt(button.dataset.shardX || '0', 10);
                const shardY = parseInt(button.dataset.shardY || '0', 10);
                onUnlockShard(shardX, shardY);
            }
        };

        // Attach to container to ensure we catch it before map does? 
        // Leaflet stops propagation on some events, but `capture: true` on window/document works best for overlays.
        const container = map.getContainer();
        container.addEventListener('click', handleUnlockClick, true); // Capture phase
        
        return () => {
            container.removeEventListener('click', handleUnlockClick, true);
        };
    }, [map, onUnlockShard]);

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
