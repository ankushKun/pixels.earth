import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { useMap, type PixelData } from '../hooks/use-map';
import { toast } from 'sonner';
import { hexToUint32, uint32ToHex } from '../lib/colors';
import { latLonToGlobalPx, globalPxToLatLon } from '../lib/projection';
import { getLocationName } from '../lib/reverse-geocode';
import { FALLBACK_LOCATION } from '../lib/geocode-core';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ShardGridOverlay } from './shard-grid-overlay';
import type { Map as LeafletMap } from 'leaflet';
import {
    PRESET_COLORS,
    TRANSPARENT_COLOR,
    DEFAULT_MAP_CENTER,
    DEFAULT_MAP_ZOOM,
    MIN_MAP_ZOOM,
    MAX_MAP_ZOOM,
    MAP_MOVE_THROTTLE_MS,
    PIXEL_SELECT_ZOOM,
    SHARD_DIMENSION,
} from '../constants';
import { WalletConnect } from './wallet-connect';
import { Button } from './ui/button';
import { Brush, Eraser, Grid2X2, Grid3X3, LayoutGrid, ScanEye, Search, Settings, Unlock, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGameSounds } from '../hooks/use-game-sounds';
import { useMagicplaceProgram, COOLDOWN_LIMIT, COOLDOWN_PERIOD } from '../hooks/use-magicplace-program';

import { useMagicplaceEvents } from '../hooks/use-magicplace-events';
// import { useReadonlyMode } from './start-using';
import { useSessionBalance } from './session-balance-provider';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSessionKey } from '../hooks/use-session-key';
import { CooldownTimer } from './cooldown-timer';
import { Avatar, AvatarFallback } from './ui/avatar';
import { useGunPresence } from '../hooks/use-gun-presence';
import { divIcon } from 'leaflet';
import { Marker as LeafletMarker } from 'react-leaflet';
import "../lib/smooth-zoom"
import { useTourActions, TourItems } from '../hooks/use-tour';
import { SettingsDialog } from './settings-dialog';
import { LocationSearch } from './location-search';
import { usePostHog } from 'posthog-js/react';

// Custom Cursor Icon with name label
const createCursorIcon = (color: string, name: string) => divIcon({
    className: 'bg-transparent',
    html: `
        <div style="
            transform: translate(-3px, -3px);
            pointer-events: none;
        ">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z" fill="${color}" stroke="white" stroke-width="1"/>
            </svg>
            <div style="
                position: absolute;
                left: 16px;
                top: 14px;
                background: ${color};
                color: white;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 600;
                font-family: system-ui, -apple-system, sans-serif;
                white-space: nowrap;
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                border: 1px solid rgba(255,255,255,0.3);
            ">${name}</div>
        </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [0, 0],
});

// Icons as inline SVGs
const PaintBrushIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
        <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </svg>
);

const ShareIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="16,6 12,2 8,6" />
        <line x1="12" x2="12" y1="2" y2="15" />
    </svg>
);

const ChevronIcon = ({ direction = 'down' }: { direction?: 'up' | 'down' }) => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-transform ${direction === 'up' ? 'rotate-180' : ''}`}
    >
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

const CompassIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" />
    </svg>
);

// Format large numbers compactly (1.2K, 10.4K, 1.34M, etc.)
function formatCompactNumber(num: number): string {
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(num >= 10_000_000 ? 1 : 2) + 'M';
    }
    if (num >= 1_000) {
        return (num / 1_000).toFixed(num >= 10_000 ? 1 : 2) + 'K';
    }
    return num.toString();
}

// Component to handle map events
function MapEventsHandler({ onMapClick, onMapReady, onMoveEnd, onZoomEnd, onMouseMove, onMouseOut }: {
    onMapClick: (lat: number, lng: number) => void;
    onMapReady: (map: LeafletMap) => void;
    onMoveEnd: () => void;
    onZoomEnd?: () => void;
    onMouseMove?: (lat: number, lng: number) => void;
    onMouseOut?: () => void;
}) {
    const map = useMapEvents({
        click: (e) => {
            onMapClick(e.latlng.lat, e.latlng.lng);
        },
        mousemove: (e) => {
            onMouseMove?.(e.latlng.lat, e.latlng.lng);
        },
        mouseout: () => {
            onMouseOut?.();
        },
        moveend: () => {
            onMoveEnd();
        },
        zoomend: () => {
            onZoomEnd?.();
        },
    });

    useEffect(() => {
        onMapReady(map);
    }, [map, onMapReady]);

    return null;
}

// LocalStorage key for persisting map view
const MAP_VIEW_STORAGE_KEY = 'pixelsearth-map-view';

interface SavedMapView {
    center: [number, number];
    zoom: number;
}

function getSavedMapView(): SavedMapView | null {
    try {
        const saved = localStorage.getItem(MAP_VIEW_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.center && typeof parsed.zoom === 'number') {
                return parsed;
            }
        }
    } catch (e) {
        // Ignore parsing errors
    }
    return null;
}

function saveMapView(center: [number, number], zoom: number) {
    try {
        localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify({ center, zoom }));
    } catch (e) {
        // Ignore storage errors
    }
}

function Color({ color, selected, onClick }: { color: string, selected: boolean, onClick: () => void }) {
    return (
        <Button
            className={cn(
                "w-full h-10 p-0 relative overflow-visible transition-all duration-200",
                selected
                    ? "ring-1 ring-zinc-800 scale-105 z-10 shadow-lg"
                    : "hover:scale-105 hover:shadow opacity-90 hover:opacity-100 ring-1 ring-black/30"
            )}
            style={{ backgroundColor: color }}
            onClick={onClick}
            variant={"ghost"}
        >
            <div className="absolute inset-0 flex items-center justify-center">
                <Brush className={cn("w-5! h-5! text-black/80! fill-white drop-shadow-black/70 transition-all duration-200",
                    selected ? "opacity-80" : "opacity-0"
                )} />
            </div>
            <span className="sr-only">Select color {color}</span>
        </Button>
    );
}

export function PixelCanvas() {
    const { onlineUsers, updateMyPresence, myId } = useGunPresence();
    const actions = useTourActions();
    const posthog = usePostHog();

    const {
        mapRef,
        selectedPixel,
        hoveredPixel,
        placedPixelCount,
        localPixels,
        focusOnPixel,
        handleMapClick,
        handleMapHover,
        handleMapHoverOut,
        updateSelectedHighlightColor,
        initializeMap,
        updateMarker,
        removeMarker,
        bulkUpdateMarkers,
    } = useMap();



    // Load saved map view from localStorage
    const savedMapView = useMemo(() => getSavedMapView(), []);
    const initialCenter = savedMapView?.center ?? DEFAULT_MAP_CENTER;
    const initialZoom = savedMapView?.zoom ?? DEFAULT_MAP_ZOOM;

    const lastMoveTimeRef = useRef<number>(0);
    const throttledAction = useCallback(() => {
        const now = Date.now();
        if (now - lastMoveTimeRef.current < MAP_MOVE_THROTTLE_MS) return;
        lastMoveTimeRef.current = now;
        // Could add tile loading here if needed
    }, []);

    // Track if user has manually interacted with the map (not auto-focused)
    const userHasMovedMapRef = useRef(!!savedMapView);

    // Save map view to localStorage when it changes (only if user has moved)
    const saveCurrentMapView = useCallback(() => {
        if (mapRef.current && userHasMovedMapRef.current) {
            const center = mapRef.current.getCenter();
            const zoom = mapRef.current.getZoom();
            saveMapView([center.lat, center.lng], zoom);
        }
    }, [mapRef]);

    const [selectedColor, setSelectedColor] = useState<string>(PRESET_COLORS[0]);

    // Update presence on mouse move
    const handleMapMouseMove = useCallback((lat: number, lng: number) => {
        // Existing hover logic
        handleMapHover(lat, lng, selectedColor === TRANSPARENT_COLOR ? '#ffffff' : selectedColor);
        
        // Gun Presence - broadcast GPS coordinates directly
        updateMyPresence(lat, lng);
    }, [handleMapHover, selectedColor, updateMyPresence]);
    const [showRecentPixels, setShowRecentPixels] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
    const [isToolbarExpanded, setIsToolbarExpanded] = useState(true);
    const [currentZoom, setCurrentZoom] = useState(DEFAULT_MAP_ZOOM);
    const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
    const [isMapReady, setIsMapReady] = useState(false);
    const [showShardGrid, setShowShardGrid] = useState(false);
    const [shardsAggregated, setShardsAggregated] = useState(false);
    const [visibleShards, setVisibleShards] = useState<{ x: number; y: number }[]>([]);
    const [showRecentShards, setShowRecentShards] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
    const [lockedShardAlert, setLockedShardAlert] = useState<{ x: number; y: number } | null>(null);
    const [unlockedShards, setUnlockedShards] = useState<Set<string>>(new Set());
    const [recentUnlockedShards, setRecentUnlockedShards] = useState<{ x: number; y: number; timestamp: number; locationName?: string }[]>([]);
    const [highlightShard, setHighlightShard] = useState<{ x: number; y: number } | null>(null);
    const [unlockingShard, setUnlockingShard] = useState<{ x: number; y: number; status: string } | null>(null);
    const [shardMetadata, setShardMetadata] = useState<Map<string, { creator: string, pixelCount: number }>>(new Map());
    const [cooldownState, setCooldownState] = useState<{ placed: number, lastTimestamp: number }>({ placed: 0, lastTimestamp: 0 });
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    // Track which items have already been seen (to prevent animation on subsequent re-renders)
    // Items are marked as "seen" via useEffect AFTER they render with animation
    const seenPixelsRef = useRef<Set<string>>(new Set());
    const seenShardsRef = useRef<Set<string>>(new Set());

    const { sessionKey } = useSessionKey();
    const wallet = useWallet();

    // Magicplace program hook for checking shard delegation status
    const {
        checkShardDelegation,
        initializeShard,
        estimateShardUnlockCost,
        getAllDelegatedShards,
        placePixelOnER,
        erasePixelOnER,
        getPixelFromShard,
        fetchSessionAccount
    } = useMagicplaceProgram();

    // Poll session account for cooldowns
    useEffect(() => {
        if (!sessionKey?.keypair) return;

        const updateCooldown = async () => {
            const acc = await fetchSessionAccount(sessionKey.keypair!.publicKey);
            if (acc) {
                setCooldownState({
                    placed: acc.cooldownCounter,
                    lastTimestamp: acc.lastPlaceTimestamp.toNumber()
                });
            } else {
                // New session or fetch failed
                setCooldownState({ placed: 0, lastTimestamp: 0 });
            }
        };

        updateCooldown();
        const interval = setInterval(updateCooldown, 5000); // Check every 5s
        return () => clearInterval(interval);
    }, [sessionKey, fetchSessionAccount]);

    // Cooldown Limit Toast
    useEffect(() => {
        if (cooldownState.placed >= COOLDOWN_LIMIT) {
            const now = Math.floor(Date.now() / 1000);
            // Only show toast if the limit was reached extremely recently (<2s)
            // This prevents spam on page refresh if we are mid-cooldown
            if (now - cooldownState.lastTimestamp < 2) {
                toast.error("Limit reached! Wait 30 seconds.");
                // Show first-time cooldown explanation
                actions.start(TourItems.CooldownLimitReached);
            }
        }
    }, [cooldownState, actions]);

    // Readonly mode - hide interactions
    // Readonly mode - hide interactions
    // const { isReadonly } = useReadonlyMode();
    const isReadonly = !wallet.connected;

    // Session balance for transaction checks
    const { checkBalance, refreshBalance } = useSessionBalance();

    // Initial fetch of delegated shards pixels
    const fetchedRef = useRef(false);

    // Fetch recent feed (shards + pixels) from backend
    useEffect(() => {
        if (!isMapReady) return;

        const fetchFeed = async () => {
            try {
                const res = await fetch(process.env.NODE_ENV=="production" ? "https://arweave.tech/api/magicplace/feed" : '/feed');
                if (res.ok) {
                    const { pixels, shards } = await res.json();

                    // Calculate pixel counts per shard from feed pixels
                    const shardPixelCounts = new Map<string, number>();
                    if (pixels && pixels.length > 0) {
                        pixels.forEach((p: any) => {
                            if (p.color > 0) {
                                const shardX = Math.floor(p.px / SHARD_DIMENSION);
                                const shardY = Math.floor(p.py / SHARD_DIMENSION);
                                const shardKey = `${shardX},${shardY}`;
                                shardPixelCounts.set(shardKey, (shardPixelCounts.get(shardKey) || 0) + 1);
                            }
                        });
                    }

                    // Update Pixels
                    if (pixels && pixels.length > 0) {
                        const mappedPixels = pixels.map((p: any) => {
                            const colorHex = p.color > 0 ? PRESET_COLORS[p.color - 1] : null;
                            return {
                                px: p.px,
                                py: p.py,
                                color: colorHex ? hexToUint32(colorHex) : 0,
                                timestamp: p.timestamp,
                                locationName: p.location_name || undefined // Include location from API
                            };
                        });
                        
                        // Draw pixels (oldest to newest)
                        bulkUpdateMarkers([...mappedPixels].reverse());
                        
                        // Fetch missing location names for recent pixels (newest first in mappedPixels)
                        // This ensures that when we click/hover recent pixels, we have the location

                    }

                    // Update Recent Shards List and Unlocked State
                    if (shards && shards.length > 0) {
                        setRecentUnlockedShards(prev => {
                            const mapped = shards.map((s: any) => ({
                                x: s.shard_x,
                                y: s.shard_y,
                                timestamp: s.timestamp,
                                locationName: s.location_name || undefined // Include location from API
                            }));
                            const map = new Map();
                            [...mapped, ...prev].forEach(s => map.set(`${s.x},${s.y}`, s));
                            const result = Array.from(map.values()).sort((a: any, b: any) => b.timestamp - a.timestamp).slice(0, 50);
                            
                            // Fetch missing location names for first 10 shards without them
                            result.slice(0, 10).forEach((shard: any) => {
                                if (!shard.locationName) {
                                    const centerPx = (shard.x + 0.5) * SHARD_DIMENSION;
                                    const centerPy = (shard.y + 0.5) * SHARD_DIMENSION;
                                    const { lat, lon } = globalPxToLatLon(centerPx, centerPy);
                                    getLocationName(lat, lon).then(locationName => {
                                        setRecentUnlockedShards(current => current.map(s => 
                                            (s.x === shard.x && s.y === shard.y) ? { ...s, locationName } : s
                                        ));
                                    });
                                }
                            });
                            
                            return result;
                        });

                        setUnlockedShards(prev => {
                            const next = new Set(prev);
                            shards.forEach((s: any) => next.add(`${s.shard_x},${s.shard_y}`));
                            return next;
                        });

                        // Populate shardMetadata with pixel counts from feed
                        setShardMetadata(prev => {
                            const next = new Map(prev);
                            shards.forEach((s: any) => {
                                const shardKey = `${s.shard_x},${s.shard_y}`;
                                if (!next.has(shardKey)) {
                                    next.set(shardKey, {
                                        creator: 'Unknown',
                                        pixelCount: shardPixelCounts.get(shardKey) || 0
                                    });
                                }
                            });
                            return next;
                        });
                    }
                }
            } catch (e) {
                console.error("Failed to fetch feed", e);
            }
        };
        fetchFeed();
    }, [isMapReady, bulkUpdateMarkers]);

    useEffect(() => {
        if (fetchedRef.current) return;

        const fetchPixels = async () => {
            // Prevent multiple fetches
            fetchedRef.current = true;

            console.log("Fetching all delegated shards from ER...");
            const shards = await getAllDelegatedShards();
            console.log(`Found ${shards.length} delegated shards`);

            const allPixels: PixelData[] = [];
            const newUnlockedShards = new Set<string>();
            const newMetadata = new Map<string, { creator: string, pixelCount: number }>();

            for (const shard of shards) {
                const shardKey = `${shard.shardX},${shard.shardY}`;
                // Mark as unlocked
                newUnlockedShards.add(shardKey);

                let pixelCount = 0;

                // Unpack pixels (8-bit direct indexing)
                const pixels = shard.pixels;
                for (let i = 0; i < pixels.length; i++) {
                    const colorIndex = pixels[i];
                    if (colorIndex === undefined || colorIndex === 0) continue;

                    pixelCount++;
                    const colorHex = PRESET_COLORS[colorIndex - 1]; // 1-based index
                    if (colorHex) {
                        const localY = Math.floor(i / SHARD_DIMENSION);
                        const localX = i % SHARD_DIMENSION;

                        allPixels.push({
                            px: shard.shardX * SHARD_DIMENSION + localX,
                            py: shard.shardY * SHARD_DIMENSION + localY,
                            color: hexToUint32(colorHex),
                            timestamp: 0
                        });
                    }
                }

                newMetadata.set(shardKey, {
                    creator: shard.creator.toBase58(),
                    pixelCount
                });
            }

            // Update metadata
            if (newMetadata.size > 0) {
                setShardMetadata(prev => {
                    const next = new Map(prev);
                    newMetadata.forEach((v, k) => next.set(k, v));
                    return next;
                });
            }

            // Update unlocked shards state
            if (newUnlockedShards.size > 0) {
                setUnlockedShards(prev => {
                    const next = new Set(prev);
                    newUnlockedShards.forEach(s => next.add(s));
                    return next;
                });

                /* 
                // Don't populate "Recent Shards" with historical state (which lacks timestamps).
                // "Recent Shards" should only come from Backend Feed or Live Events.
                
                // Also populate the list for the UI panel
                setRecentUnlockedShards(prev => {
                     // ... 
                });
                */
            }

            // Bulk update map
            if (allPixels.length > 0) {
                console.log(`Loading ${allPixels.length} pixels to map`);
                bulkUpdateMarkers(allPixels);
            }
        };

        fetchPixels();
    }, [getAllDelegatedShards, bulkUpdateMarkers]);

    // Auto-focus on a popular shard if first time visiting (no history)
    const hasAutoFocusedRef = useRef(false);
    useEffect(() => {
        // If map isn't ready, or we already focused, or we have a saved view, do nothing
        if (!isMapReady || hasAutoFocusedRef.current || savedMapView) return;

        // If we have no shard data yet, we can't choose.
        if (shardMetadata.size === 0) return;

        // Get all shards from metadata
        const shards = Array.from(shardMetadata.entries()).map(([key, data]) => {
            const [x, y] = key.split(',').map(Number);
            return { x, y, pixelCount: data.pixelCount };
        });

        // Sort by pixel count descending
        shards.sort((a, b) => b.pixelCount - a.pixelCount);

        // Take top 5
        const top5 = shards.slice(0, 5);

        if (top5.length > 0) {
            // Pick random one
            const randomShard = top5[Math.floor(Math.random() * top5.length)];
            
            if (!randomShard || randomShard.x === undefined || randomShard.y === undefined) return;

            console.log("Auto-focusing on popular shard:", randomShard);

            // Calculate center
            const centerPx = (randomShard.x + 0.5) * SHARD_DIMENSION;
            const centerPy = (randomShard.y + 0.5) * SHARD_DIMENSION;
            const { lat, lon } = globalPxToLatLon(centerPx, centerPy);

            // Fly there with animation
            mapRef.current?.setView([lat, lon], 13, { animate: true });
            
            // Mark as done
            hasAutoFocusedRef.current = true;
        }
    }, [isMapReady, shardMetadata, savedMapView, mapRef]);

    // Track which shards we're currently checking to avoid duplicate requests
    const checkingShards = useRef<Set<string>>(new Set());

    // Check delegation status for visible shards
    // An initialized shard is always delegated, so we check if account exists and is delegated
    useEffect(() => {
        if (currentZoom < 12 || visibleShards.length === 0 || visibleShards.length >= 90) {
            return;
        }

        const checkShards = async () => {
            // Filter to shards that need checking
            const shardsToCheck = visibleShards.filter(shard => {
                const shardKey = `${shard.x},${shard.y}`;
                return !unlockedShards.has(shardKey) && !checkingShards.current.has(shardKey);
            });

            if (shardsToCheck.length === 0) return;

            // Mark all as checking
            shardsToCheck.forEach(shard => {
                checkingShards.current.add(`${shard.x},${shard.y}`);
            });

            // Check all shards in parallel
            const results = await Promise.all(
                shardsToCheck.map(async shard => {
                    const shardKey = `${shard.x},${shard.y}`;
                    try {
                        const status = await checkShardDelegation(shard.x, shard.y);
                        return { shard, shardKey, status, error: null };
                    } catch (err) {
                        console.debug(`Failed to check shard (${shard.x}, ${shard.y}):`, err);
                        return { shard, shardKey, status: null, error: err };
                    } finally {
                        checkingShards.current.delete(shardKey);
                    }
                })
            );

            // Process results
            const delegatedShards = results.filter(r => r.status === 'delegated');

            if (delegatedShards.length > 0) {
                setUnlockedShards(prev => {
                    const newSet = new Set(prev);
                    delegatedShards.forEach(r => newSet.add(r.shardKey));
                    return newSet;
                });

                setRecentUnlockedShards(prev => {
                    let updated = [...prev];
                    delegatedShards.forEach(r => {
                        updated = updated.filter(s => !(s.x === r.shard.x && s.y === r.shard.y));
                        updated.unshift({ x: r.shard.x, y: r.shard.y, timestamp: Date.now() });
                    });
                    return updated.slice(0, 50);
                });
            }
        };

        checkShards();
    }, [visibleShards, currentZoom, checkShardDelegation, unlockedShards]);

    // Force crosshair cursor on map container
    useEffect(() => {
        if (mapRef.current) {
            const container = mapRef.current.getContainer();
            container.style.cursor = 'crosshair';
            // Also set on all child elements that Leaflet might override
            const style = document.createElement('style');
            style.textContent = `
                .leaflet-container, .leaflet-container * { cursor: crosshair !important; }
                .leaflet-grab { cursor: crosshair !important; }
                .leaflet-dragging .leaflet-grab { cursor: crosshair !important; }
            `;
            document.head.appendChild(style);
            return () => {
                document.head.removeChild(style);
            };
        }
    }, [mapRef.current]);

    // Update highlight color when selected color changes
    useEffect(() => {
        if (selectedPixel) {
            updateSelectedHighlightColor(selectedColor === TRANSPARENT_COLOR ? '#ffffff' : selectedColor);
        }
    }, [selectedColor, selectedPixel, updateSelectedHighlightColor]);

    // Pop sound for pixel placement
    const { playPop, playUnlock, playFail, isMuted, toggleMute } = useGameSounds();

    // Check if a pixel is in a locked shard
    const isShardLocked = useCallback((px: number, py: number): boolean => {
        const shardX = Math.floor(px / SHARD_DIMENSION);
        const shardY = Math.floor(py / SHARD_DIMENSION);
        const shardKey = `${shardX},${shardY}`;
        // Check if this shard has been unlocked
        return !unlockedShards.has(shardKey);
    }, [unlockedShards]);

    // Show locked shard dialog (zoom in if zoomed out, but never zoom out)
    const zoomToLockedShard = useCallback((px: number, py: number) => {
        if (!mapRef.current) return;

        const shardX = Math.floor(px / SHARD_DIMENSION);
        const shardY = Math.floor(py / SHARD_DIMENSION);

        // Calculate center of the shard
        const centerPx = (shardX + 0.5) * SHARD_DIMENSION;
        const centerPy = (shardY + 0.5) * SHARD_DIMENSION;
        const { lat, lon } = globalPxToLatLon(centerPx, centerPy);

        // Only zoom IN if user is zoomed out (below level 13)
        // Never zoom OUT if user is already zoomed in
        const currentZoomLevel = mapRef.current.getZoom();
        if (currentZoomLevel < 13) {
            mapRef.current.flyTo([lat, lon], 13, { duration: 0.5 });
        }

        // Store the locked shard coordinates for visual highlight
        setLockedShardAlert({ x: shardX, y: shardY });
        
        // Store shard info in tour store for the unlock button
        actions.setLockedShard({ x: shardX, y: shardY });
        
        // Show the dialog
        actions.forceStart(TourItems.ClickedOnLockedShard);
        
        // Clear visual highlight after animation
        setTimeout(() => setLockedShardAlert(null), 600);
    }, [mapRef, actions]);

    // Place pixel at coordinates
    const handlePlacePixelAt = useCallback(async (px: number, py: number) => {
        // Check Cooldown
        if (cooldownState.placed >= COOLDOWN_LIMIT) {
            const now = Math.floor(Date.now() / 1000);
            const elapsed = now - cooldownState.lastTimestamp;
            if (elapsed < COOLDOWN_PERIOD) {
                playFail();
                toast.error(`Burst limit reached! Wait ${COOLDOWN_PERIOD - elapsed}s`);
                // Show cooldown explanation dialog
                actions.forceStart(TourItems.CooldownLimitReached);
                return;
            }
        }

        const shardX = Math.floor(px / SHARD_DIMENSION);
        const shardY = Math.floor(py / SHARD_DIMENSION);

        // Check if this shard is currently being unlocked
        if (unlockingShard && unlockingShard.x === shardX && unlockingShard.y === shardY) {
            toast.info("Shard creation is in progress. Please wait...");
            return;
        }

        const isTransparent = selectedColor === TRANSPARENT_COLOR;
        // Transparent = 0 (unset), all other colors go through hexToUint32
        const color = isTransparent ? 0 : hexToUint32(selectedColor);

        // Check if locked
        if (isShardLocked(px, py)) {
            // Play fail sound
            playFail();
            // If checking fails or we are in a weird state, triggering zoom is fine
            zoomToLockedShard(px, py);
            return;
        }

        try {
            if (isTransparent) {
                await erasePixelOnER(px, py);
                removeMarker(`${px},${py}`);
                toast.success("Pixel erased", { duration: 1500 });

                // Track pixel erased event in PostHog
                const shardX = Math.floor(px / SHARD_DIMENSION);
                const shardY = Math.floor(py / SHARD_DIMENSION);
                const { lat, lon } = globalPxToLatLon(px, py);
                posthog.capture('pixel_placed', {
                    // Position data
                    pixel_x: px,
                    pixel_y: py,
                    latitude: lat,
                    longitude: lon,
                    shard_x: shardX,
                    shard_y: shardY,
                    shard_key: `${shardX},${shardY}`,
                    // Color data
                    color_hex: TRANSPARENT_COLOR,
                    color_index: 0,
                    // User data
                    wallet_address: wallet.publicKey?.toBase58() || 'unknown',
                    session_key: sessionKey?.keypair?.publicKey.toBase58() || 'unknown',
                    // Context
                    current_zoom: currentZoom,
                    is_erasing: true,
                    timestamp: Date.now(),
                });
            } else {
                // Find color index (1-based) for contract
                const colorIndex = PRESET_COLORS.indexOf(selectedColor as any) + 1;

                if (colorIndex <= 0) {
                    throw new Error("Invalid color selected");
                }

                // Helper function to place pixel with auto-redelegate on failure
                const placeWithRedelegation = async () => {
                    try {
                        await placePixelOnER(px, py, colorIndex);
                    } catch (e) {
                        const errMsg = e instanceof Error ? e.message : String(e);
                        
                        // If delegation issue, try to re-delegate and retry once
                        if (errMsg.includes("InvalidWritableAccount") || errMsg.includes("AccountNotFound")) {
                            console.warn("[placePixel] Delegation issue detected, attempting re-delegation...");
                            toast.loading("Re-delegating shard...", { duration: 3000 });
                            
                            const shardX = Math.floor(px / SHARD_DIMENSION);
                            const shardY = Math.floor(py / SHARD_DIMENSION);
                            
                            try {
                                // initializeShard will check state and delegate if needed
                                await initializeShard(shardX, shardY);
                                console.log("[placePixel] Re-delegation successful, retrying pixel placement...");
                                
                                // Retry pixel placement
                                await placePixelOnER(px, py, colorIndex);
                            } catch (delegateErr) {
                                console.error("[placePixel] Re-delegation failed:", delegateErr);
                                throw new Error(`Re-delegation failed: ${delegateErr instanceof Error ? delegateErr.message : String(delegateErr)}`);
                            }
                        } else {
                            throw e; // Non-delegation error, propagate
                        }
                    }
                };

                await placeWithRedelegation();

                // Optimistic Cooldown Update
                setCooldownState(prev => {
                    const now = Math.floor(Date.now() / 1000);
                    let { placed, lastTimestamp } = prev;

                    if (placed >= COOLDOWN_LIMIT) {
                        if (now - lastTimestamp >= COOLDOWN_PERIOD) {
                            placed = 0;
                        }
                    }

                    placed += 1;

                    if (placed >= COOLDOWN_LIMIT) {
                        lastTimestamp = now;
                    }

                    return { placed, lastTimestamp };
                });
                // Sync with chain
                if (sessionKey?.keypair) {
                    fetchSessionAccount(sessionKey.keypair.publicKey).then(acc => {
                        if (acc) {
                            setCooldownState({
                                placed: acc.cooldownCounter,
                                lastTimestamp: acc.lastPlaceTimestamp.toNumber()
                            });
                        }
                    });
                }

                updateMarker(px, py, color);
                toast.success("Pixel placed", { duration: 1500 });

                // Update pixel count in shard metadata
                const shardX = Math.floor(px / SHARD_DIMENSION);
                const shardY = Math.floor(py / SHARD_DIMENSION);
                const shardKey = `${shardX},${shardY}`;
                setShardMetadata(prev => {
                    const next = new Map(prev);
                    const existing = next.get(shardKey);
                    if (existing) {
                        next.set(shardKey, { ...existing, pixelCount: existing.pixelCount + 1 });
                    }
                    return next;
                });

                // Track pixel placed event in PostHog
                const { lat, lon } = globalPxToLatLon(px, py);
                posthog.capture('pixel_placed', {
                    // Position data
                    pixel_x: px,
                    pixel_y: py,
                    latitude: lat,
                    longitude: lon,
                    shard_x: shardX,
                    shard_y: shardY,
                    shard_key: shardKey,
                    // Color data
                    color_hex: selectedColor,
                    color_index: colorIndex,
                    // User data
                    wallet_address: wallet.publicKey?.toBase58() || 'unknown',
                    session_key: sessionKey?.keypair?.publicKey.toBase58() || 'unknown',
                    // Context
                    current_zoom: currentZoom,
                    is_erasing: false,
                    timestamp: Date.now(),
                });
            }

            // Play pop sound
            playPop();
        } catch (e) {
            playFail();
            console.error("Failed to place pixel:", e);
            toast.error("Failed to place pixel: " + (e instanceof Error ? e.message : String(e)));
        }
    }, [selectedColor, updateMarker, removeMarker, playPop, playFail, isShardLocked, placePixelOnER, erasePixelOnER, unlockingShard, zoomToLockedShard, cooldownState, initializeShard, posthog, wallet.publicKey, sessionKey, currentZoom]);



    // Handle shard unlock
    const handleUnlockShard = useCallback(async (shardX: number, shardY: number) => {
        const shardKey = `${shardX},${shardY}`;

        // Disable if already unlocking
        if (unlockingShard) return;

        // Use a toast ID to update the same toast
        const toastId = toast.loading(`Unlocking shard (${shardX}, ${shardY})...`);
        setUnlockingShard({ x: shardX, y: shardY, status: "processing" });

        try {
            // Get accurate cost estimate based on current shard state
            toast.loading("Estimating cost...", { id: toastId });
            const costEstimate = await estimateShardUnlockCost(shardX, shardY);

            // If shard is already fully unlocked (delegated), nothing to do
            if (costEstimate.total === 0) {
                console.log(`Shard (${shardX}, ${shardY}) is already unlocked`);
                setUnlockedShards(prev => {
                    const newSet = new Set(prev);
                    newSet.add(shardKey);
                    return newSet;
                });
                toast.success("Shard already unlocked!", { id: toastId });
                setUnlockingShard(null);
                return;
            }

            // Check session balance first with accurate cost
            const hasBalance = await checkBalance(
                costEstimate.total,
                `Unlock shard (${shardX}, ${shardY})`,
                () => handleUnlockShard(shardX, shardY) // Retry callback
            );

            if (!hasBalance) {
                // Popup will be shown by the provider
                playFail();
                toast.dismiss(toastId);
                setUnlockingShard(null); // Reset so retry can start fresh
                return;
            }

            // Play pop sound as feedback
            playPop();

            // Initialize and delegate the shard
            await initializeShard(shardX, shardY, (status) => {
                toast.loading(status, { id: toastId });
            });

            // Success
            toast.success("Shard unlocked!", { id: toastId });
            playUnlock();

            // Refresh balance after transaction
            refreshBalance();

            // Add to unlocked set
            setUnlockedShards(prev => {
                const newSet = new Set(prev);
                newSet.add(shardKey);
                return newSet;
            });

            // Update shard metadata with owner info
            setShardMetadata(prev => {
                const next = new Map(prev);
                next.set(shardKey, {
                    creator: wallet.publicKey?.toBase58() || 'Unknown',
                    pixelCount: 0 // Fresh shard has no pixels yet
                });
                return next;
            });

            // Add to recent unlocked list
            setRecentUnlockedShards(prev => {
                const newShard = { x: shardX, y: shardY, timestamp: Date.now() };
                const filtered = prev.filter(s => !(s.x === shardX && s.y === shardY));
                return [newShard, ...filtered].slice(0, 50);
            });

            // Fetch location name asynchronously for the newly unlocked shard
            const centerPx = (shardX + 0.5) * SHARD_DIMENSION;
            const centerPy = (shardY + 0.5) * SHARD_DIMENSION;
            const { lat, lon } = globalPxToLatLon(centerPx, centerPy);
            getLocationName(lat, lon).then(locationName => {
                setRecentUnlockedShards(current => current.map(s => 
                    (s.x === shardX && s.y === shardY) ? { ...s, locationName } : s
                ));
            });

            // Track shard unlocked event in PostHog
            posthog.capture('shard_unlocked', {
                // Position data
                shard_x: shardX,
                shard_y: shardY,
                shard_key: shardKey,
                center_latitude: lat,
                center_longitude: lon,
                // Cost data
                unlock_cost_lamports: costEstimate.total,
                unlock_cost_sol: costEstimate.total / 1_000_000_000,
                // User data
                wallet_address: wallet.publicKey?.toBase58() || 'unknown',
                session_key: sessionKey?.keypair?.publicKey.toBase58() || 'unknown',
                // Context
                current_zoom: currentZoom,
                timestamp: Date.now(),
            });

            // Show congratulations dialog for first-time unlock
            actions.start(TourItems.UnlockedShard);

        } catch (err) {
            playFail();
            console.error("Failed to unlock shard:", err);
            const errorMessage = err instanceof Error ? err.message : "Failed to unlock shard";
            toast.error(errorMessage, { id: toastId });
        } finally {
            setUnlockingShard(null);
        }
    }, [playPop, playUnlock, playFail, initializeShard, estimateShardUnlockCost, checkBalance, refreshBalance, unlockingShard, wallet.publicKey, posthog, sessionKey, currentZoom, actions]);

    // Listen for unlock-shard events from Tour component
    useEffect(() => {
        const handleUnlockShardEvent = (event: CustomEvent<{ x: number; y: number }>) => {
            handleUnlockShard(event.detail.x, event.detail.y);
        };

        window.addEventListener('unlock-shard', handleUnlockShardEvent as EventListener);
        return () => {
            window.removeEventListener('unlock-shard', handleUnlockShardEvent as EventListener);
        };
    }, [handleUnlockShard]);


    // Place pixel at selected location
    const handlePlacePixel = useCallback(() => {
        if (!selectedPixel) return;

        // Check if shard is locked
        if (isShardLocked(selectedPixel.px, selectedPixel.py)) {
            // Double check if unlocking
            const shardX = Math.floor(selectedPixel.px / SHARD_DIMENSION);
            const shardY = Math.floor(selectedPixel.py / SHARD_DIMENSION);
            if (unlockingShard && unlockingShard.x === shardX && unlockingShard.y === shardY) {
                toast.info("Shard creation is in progress. Please wait...");
                return;
            }

            playFail();
            zoomToLockedShard(selectedPixel.px, selectedPixel.py);
            return;
        }

        if (isReadonly || !sessionKey?.keypair) {
            // Determine which tour item to show based on state
            if (!wallet.publicKey) {
                // No wallet connected - show intro
                actions.forceStart(TourItems.OnboardingIntro)
            } else if (!sessionKey?.keypair) {
                // Wallet connected but no session key
                actions.forceStart(TourItems.NeedsSessionKey)
            }
            return;
        }

        handlePlacePixelAt(selectedPixel.px, selectedPixel.py);
    }, [selectedPixel, handlePlacePixelAt, isShardLocked, zoomToLockedShard, unlockingShard, isReadonly, sessionKey, actions, wallet.publicKey]);

    // Instant place on map click when zoomed in
    const handleInstantMapClick = useCallback((lat: number, lng: number) => {
        const { px, py } = latLonToGlobalPx(lat, lng);

        const shardX = Math.floor(px / SHARD_DIMENSION);
        const shardY = Math.floor(py / SHARD_DIMENSION);

        // Check if this shard is currently being unlocked
        if (unlockingShard && unlockingShard.x === shardX && unlockingShard.y === shardY) {
            toast.info("Shard creation is in progress. Please wait...");
            return;
        }

        // Always check if shard is locked first
        if (isShardLocked(px, py)) {
            if (!isReadonly) {
                playFail();
            }
            zoomToLockedShard(px, py);
            return;
        }

        // Check if we should instant place or just select
        const isZoomedIn = currentZoom >= PIXEL_SELECT_ZOOM;
        const missingAuth = isReadonly || !sessionKey?.keypair;

        if (isZoomedIn && !missingAuth) {
            // Instant place!
            handlePlacePixelAt(px, py);
        }

        // Update selection and zoom in if needed
        handleMapClick(lat, lng, selectedColor === TRANSPARENT_COLOR ? '#ffffff' : selectedColor);

        if (missingAuth) {
            // Determine which tour item to show based on state
            if (!wallet.publicKey) {
                // No wallet connected - show intro
                actions.forceStart(TourItems.OnboardingIntro)
            } else if (!sessionKey?.keypair) {
                // Wallet connected but no session key
                actions.forceStart(TourItems.NeedsSessionKey)
            }
        }
    }, [currentZoom, handlePlacePixelAt, handleMapClick, selectedColor, isShardLocked, zoomToLockedShard, unlockingShard, isReadonly, actions, sessionKey, wallet.publicKey]);

    // Keep track of unlocking shard in a ref to use in event callbacks without re-subscribing
    const unlockingShardRef = useRef(unlockingShard);
    useEffect(() => { unlockingShardRef.current = unlockingShard; }, [unlockingShard]);

    // Real-time Event Handling
    useMagicplaceEvents(
        useCallback((event: any) => {
            const { px, py, color } = event;
            const pxNum = Number(px);
            const pyNum = Number(py);
            // newColor is palette index u8
            const colorIndex = Number(color);

            if (colorIndex <= 0 || colorIndex > PRESET_COLORS.length) {
                removeMarker(`${pxNum},${pyNum}`);
            } else {
                const colorHex = PRESET_COLORS[colorIndex - 1]; // 1-based index
                if (colorHex) {
                    const colorUint32 = hexToUint32(colorHex);
                    updateMarker(pxNum, pyNum, colorUint32);
                }
            }
        }, [updateMarker, removeMarker]),

        useCallback((event: any) => {
            const { shardX, shardY } = event;
            const x = Number(shardX);
            const y = Number(shardY);
            const shardKey = `${x},${y}`;

            // If this shard is currently being unlocked by us, ignore the event
            // to prevent the "Unlocking..." UI from disappearing prematurely.
            // The handleUnlockShard function will update the state when fully complete.
            if (unlockingShardRef.current && unlockingShardRef.current.x === x && unlockingShardRef.current.y === y) {
                console.log(`Ignoring live update for unlocking shard (${x}, ${y})`);
                return;
            }

            // Add to unlocked set
            setUnlockedShards(prev => {
                const newSet = new Set(prev);
                newSet.add(shardKey);
                return newSet;
            });

            // Add to recent list
            setRecentUnlockedShards(prev => {
                const newShard = { x, y, timestamp: Date.now() }; // Use local time for sorting/display
                // Remove if already exists, add to front
                const filtered = prev.filter(s => !(s.x === x && s.y === y));
                return [newShard, ...filtered].slice(0, 50);
            });

            // Fetch location name asynchronously for the new shard
            const centerPx = (x + 0.5) * SHARD_DIMENSION;
            const centerPy = (y + 0.5) * SHARD_DIMENSION;
            const { lat, lon } = globalPxToLatLon(centerPx, centerPy);
            getLocationName(lat, lon).then(locationName => {
                setRecentUnlockedShards(current => current.map(s => 
                    (s.x === x && s.y === y) ? { ...s, locationName } : s
                ));
            });

            // Optional: Provide visual feedback?
            console.log(`Live update: Shard (${x}, ${y}) initialized!`);
        }, [])
    );

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === 'Enter' && selectedPixel) {
                e.preventDefault();
                handlePlacePixel();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedPixel, handlePlacePixel]);

    // Copy share link
    const handleShare = useCallback(() => {
        if (!selectedPixel) {
            alert('Select a pixel first');
            return;
        }
        const shareUrl = `${window.location.origin}?px=${selectedPixel.px}&py=${selectedPixel.py}`;
        navigator.clipboard.writeText(shareUrl);
        alert('Link copied!');
    }, [selectedPixel]);

    return (
        <div className="h-dvh w-screen overflow-hidden bg-zinc-100 relative">
            {/* Full-screen Map */}
            <MapContainer
                center={initialCenter}
                zoom={initialZoom}
                minZoom={MIN_MAP_ZOOM}
                maxZoom={MAX_MAP_ZOOM}
                className="w-full h-full"
                scrollWheelZoom={false} 
                inertiaMaxSpeed={50}
                inertia={true}
                inertiaDeceleration={0}
                zoomControl={false}
                worldCopyJump={false}
                maxBounds={[[-90, -180], [90, 180]]}
                maxBoundsViscosity={1.5}
                attributionControl={false}
            >
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    noWrap={true}
                />
                <MapEventsHandler
                    onMapClick={handleInstantMapClick}
                    onMapReady={(map) => {
                        initializeMap(map);
                        setCurrentZoom(map.getZoom());
                        setIsMapReady(true);
                    }}
                    onMoveEnd={() => {
                        throttledAction();
                        // Mark that user has manually moved (unless still in auto-focus animation)
                        if (!userHasMovedMapRef.current && hasAutoFocusedRef.current) {
                            // Small delay to let auto-focus animation complete before enabling saves
                            setTimeout(() => { userHasMovedMapRef.current = true; }, 500);
                        } else {
                            userHasMovedMapRef.current = true;
                        }
                        saveCurrentMapView();
                    }}
                    onZoomEnd={() => {
                        throttledAction();
                        saveCurrentMapView();
                        if (mapRef.current) {
                            setCurrentZoom(mapRef.current.getZoom());
                        }
                    }}
                    onMouseMove={handleMapMouseMove}
                    onMouseOut={handleMapHoverOut}
                />
                <ShardGridOverlay
                    visible={showShardGrid}
                    onAggregatedChange={setShardsAggregated}
                    onVisibleShardsChange={setVisibleShards}
                    alertShard={isReadonly ? null : lockedShardAlert}
                    unlockedShards={unlockedShards}
                    onUnlockShard={isReadonly ? undefined : handleUnlockShard}
                    highlightShard={highlightShard}
                    hideLockedOverlay={isReadonly}
                    unlockingShard={unlockingShard}
                    shardMetadata={shardMetadata}
                    currentUserPublicKey={wallet.publicKey?.toBase58()}
                />
                
                {/* Live User Cursors */}
                {onlineUsers.filter(u => u.id !== myId).map(user => (
                    <LeafletMarker
                        key={user.id}
                        position={[user.lat, user.lng]}
                        icon={createCursorIcon(user.color, user.name)}
                        zIndexOffset={1000}
                        interactive={false}
                    />
                ))}
            </MapContainer>

            {/* Shard Grid Zoom Hint */}
            {showShardGrid && shardsAggregated && (
                <div className="absolute top-15 left-1/2 -translate-x-1/2 z-50">
                    <div className="bg-blue-500/95 backdrop-blur-sm text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="11" y1="8" x2="11" y2="14" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                        </svg>
                        <span>Zoom in to see individual shards</span>
                    </div>
                </div>
            )}

            {!showShardGrid && shardsAggregated && <div className="absolute top-15 left-1/2 -translate-x-1/2 z-50 ">
                <div className="bg-blue-500/95 backdrop-blur-sm text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        <line x1="11" y1="8" x2="11" y2="14" />
                        <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                    <span>Zoom in to see pixels</span>
                </div>
            </div>}

            {!showShardGrid && !shardsAggregated && currentZoom < PIXEL_SELECT_ZOOM && <div className="absolute top-15 left-1/2 -translate-x-1/2 z-50 ">
                <div className="bg-emerald-500/95 backdrop-blur-sm text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        <line x1="11" y1="8" x2="11" y2="14" />
                        <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                    <span>Zoom in to place pixels</span>
                </div>
            </div>}

            {/* Top Left - Zoom Controls */}
            <div className="absolute top-4 left-4 flex flex-col gap-2 z-40">
                <button
                    onClick={() => mapRef.current?.zoomIn()}
                    className="w-8 h-8 bg-white rounded-lg shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-colors font-bold text-lg"
                >
                    +
                </button>
                <button
                    onClick={() => mapRef.current?.zoomOut()}
                    className="w-8 h-8 bg-white rounded-lg shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-colors font-bold text-lg"
                >
                    −
                </button>
                <div className='h-0.5 bg-white'/>
                <button
                    onClick={() => {
                        const shardsArray = Array.from(unlockedShards).map(key => {
                            const [x, y] = key.split(',').map(Number);
                            return { x: x ?? 0, y: y ?? 0 };
                        });

                        if (shardsArray.length > 0 && mapRef.current) {
                            const bounds = mapRef.current.getBounds();

                            // Filter shards that are NOT in the current view
                            const shardsOutsideView = shardsArray.filter(shard => {
                                const centerPx = (shard.x + 0.5) * SHARD_DIMENSION;
                                const centerPy = (shard.y + 0.5) * SHARD_DIMENSION;
                                const { lat, lon } = globalPxToLatLon(centerPx, centerPy);
                                return !bounds.contains([lat, lon]);
                            });

                            // Pick from shards outside view, or any shard if all are visible
                            const targetShards = shardsOutsideView.length > 0 ? shardsOutsideView : shardsArray;
                            const randomShard = targetShards[Math.floor(Math.random() * targetShards.length)];
                            
                            if (!randomShard) return;
                            
                            // Focus on shard center
                            const centerPx = (randomShard.x + 0.5) * SHARD_DIMENSION;
                            const centerPy = (randomShard.y + 0.5) * SHARD_DIMENSION;
                            const { lat, lon } = globalPxToLatLon(centerPx, centerPy);
                            
                            mapRef.current.setView([lat, lon], 13, { animate: true });
                            
                            // Highlight the shard
                            setTimeout(() => {
                                setHighlightShard({ x: randomShard.x, y: randomShard.y });
                                // Clear after animation
                                setTimeout(() => setHighlightShard(null), 1500);
                            }, 300);

                        } else if (shardsArray.length === 0) {
                            toast.error('No shards unlocked yet. Be the first to unlock a shard!');
                        }
                    }}
                    className="w-8 h-8 bg-white rounded-lg shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-colors"
                    title="Explore unlocked shards"
                >
                    <CompassIcon />
                </button>
                <button
                    onClick={() => setShowShardGrid(!showShardGrid)}
                    className={`w-8 h-8 rounded-lg shadow-lg flex items-center justify-center transition-colors ${showShardGrid
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                    title="Toggle shard grid"
                >
                    <ScanEye className='w-5 h-5'/>
                </button>
                {/* search button */}
                <button
                    onClick={() => setIsSearchOpen(true)}
                    className="w-8 h-8 rounded-lg shadow-lg flex items-center justify-center transition-colors bg-white text-slate-700 hover:bg-slate-50"
                    title="Search for a location"
                >
                    <Search className='w-4 h-4'/>
                </button>
            </div>

            <div className='absolute top-8 left-16 flex flex-col gap-2 z-40'>
                {!isReadonly && (
                    <CooldownTimer
                        pixelsPlaced={cooldownState.placed}
                        maxPixels={COOLDOWN_LIMIT}
                        lastPlaceTimestamp={cooldownState.lastTimestamp}
                        cooldownPeriod={COOLDOWN_PERIOD}
                    />
                )}
            </div>

            {/* Top Right - Info */}
            <div className="absolute top-4 right-4 flex items-center gap-3 z-40">

                {/* show currently live users here */}
                <div className="hidden md:flex flex-row flex-wrap items-center gap-2 mr-2">
                    {(() => {
                        const otherUsers = onlineUsers.filter(u => u.id !== myId);
                        return (
                            <>
                                <div className="flex -space-x-2.5 hover:space-x-1.5 *:transition-all *:duration-300 *:ease-in-out">
                                    {otherUsers.slice(0, 5).map(user => (
                                        <Avatar 
                                            key={user.id} 
                                            className='w-8 h-8 border-2 hover:scale-110 transition-transform' 
                                            style={{ borderColor: 'white' }}
                                            onClick={() => {
                                                mapRef.current?.setView([user.lat, user.lng], 15, { animate: true });
                                            }}
                                        >
                                            <AvatarFallback style={{ backgroundColor: user.color, color: 'white', fontSize: '10px', fontWeight: 600 }}>
                                                {user.name.slice(0, 2).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                    ))}
                                </div>
                                {otherUsers.length > 5 && (
                                    <span className="text-xs font-semibold text-slate-300 bg-slate-800/50 px-2 py-1 rounded-full backdrop-blur-sm">
                                        +{otherUsers.length - 5} more
                                    </span>
                                )}
                            </>
                        );
                    })()}
                </div>

                {/* Shards Count - Toggle for Recent Shard unlocks */}
                <button
                    onClick={() => setShowRecentShards(!showRecentShards)}
                    className={`backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 transition-colors ${showRecentShards
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'bg-white/90 text-slate-700 hover:bg-white'
                        }`}
                    title="Toggle recent shards"
                >
                    <Unlock className="w-4 h-4" />
                    <span className="hidden sm:inline">{formatCompactNumber(unlockedShards.size)}</span>
                </button>
                {/* Pixels Count - Toggle for Recent Pixels */}
                <button
                    onClick={() => setShowRecentPixels(!showRecentPixels)}
                    className={`backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 transition-colors ${showRecentPixels
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'bg-white/90 text-slate-700 hover:bg-white'
                        }`}
                    title="Toggle recent pixels"
                >
                    <LayoutGrid className='w-4 h-4' />
                    <span className="hidden sm:inline">{formatCompactNumber(placedPixelCount)}</span>
                </button>

                <WalletConnect onMenuOpenChange={setIsWalletMenuOpen} />
            </div>

            {/* Panels Container - Right side */}
            {!isWalletMenuOpen && (showRecentPixels || showRecentShards) && (
                <div className="absolute top-16 right-4 z-40 flex flex-col gap-3 max-h-[calc(100vh-200px)]">
                    {/* Recent Pixels Panel */}
                    {showRecentPixels && (
                        <div className="w-72 bg-white/60 backdrop-blur-xs rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-64">
                            <div className="p-3 border-b border-slate-200 font-semibold text-slate-700 flex items-center justify-between shrink-0">
                                <span>Recent Pixels</span>
                                <button onClick={() => setShowRecentPixels(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                            </div>
                            <div className="overflow-y-auto overflow-x-clip flex-1">
                                {localPixels.length === 0 ? (
                                    <div className="p-4 text-center text-slate-400 text-sm">
                                        No pixels placed yet. Click on the map to start painting!
                                    </div>
                                ) : (
                                    localPixels.slice(0, 20).map((pixel, index) => {
                                        const isTransparent = pixel.color === 0;
                                        const pixelKey = `${pixel.px},${pixel.py}`;
                                        // Items placed within the last 5 seconds are considered "new"
                                        // Only animate if not already seen
                                        const isRecentlyPlaced = (Date.now() / 1000) - pixel.timestamp < 5;
                                        const shouldAnimate = isRecentlyPlaced && !seenPixelsRef.current.has(pixelKey);
                                        
                                        return (
                                            <div
                                                key={`${pixel.px}-${pixel.py}-${pixel.timestamp}`}
                                                className={`p-3 hover:bg-slate-50/50 transition-colors flex items-center gap-3 border-b border-slate-100 last:border-0 cursor-pointer ${shouldAnimate ? 'animate-new-pixel' : ''}`}
                                                style={shouldAnimate ? { animationDelay: `${index * 50}ms` } : undefined}
                                                onAnimationEnd={() => seenPixelsRef.current.add(pixelKey)}
                                                onClick={() => {
                                                    focusOnPixel(pixel.px, pixel.py);
                                                }}
                                            >
                                                <div
                                                    className={`w-8 h-8 rounded-lg shadow-inner border border-slate-200 shrink-0 ${shouldAnimate ? 'animate-pop-in' : ''}`}
                                                    style={isTransparent ? {
                                                        backgroundImage: `
                          linear-gradient(45deg, #ccc 25%, transparent 25%),
                          linear-gradient(-45deg, #ccc 25%, transparent 25%),
                          linear-gradient(45deg, transparent 75%, #ccc 75%),
                          linear-gradient(-45deg, transparent 75%, #ccc 75%)
                        `,
                                                        backgroundSize: '8px 8px',
                                                        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                                                        backgroundColor: '#fff'
                                                    } : { backgroundColor: uint32ToHex(pixel.color) }}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium text-slate-700 truncate">
                                                        {pixel.locationName && pixel.locationName !== FALLBACK_LOCATION ? (
                                                            <>at {pixel.locationName}</>
                                                        ) : (
                                                            <>({pixel.px}, {pixel.py})</>
                                                        )}
                                                        {isTransparent && <span className="text-slate-400 ml-1 text-xs">(erased)</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}

                    {/* Unlocked Shards Panel */}
                    {showRecentShards && (
                        <div className="w-72 bg-white/60 backdrop-blur-xs rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-64">
                            <div className="p-3 border-b border-slate-200 font-semibold text-slate-700 flex items-center justify-between shrink-0">
                                <span className="flex items-center gap-2">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                                    </svg>
                                    Recent Shard Unlocks
                                </span>
                                <button onClick={() => setShowRecentShards(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                            </div>
                            <div className="overflow-y-auto flex-1">
                                {recentUnlockedShards.length === 0 ? (
                                    <div className="p-4 text-center text-slate-400 text-sm">
                                        No shards unlocked yet. Hover over shards and click "Unlock" to start!
                                    </div>
                                ) : (
                                    recentUnlockedShards.slice(0, 20).map((shard, index) => {
                                        const shardKey = `${shard.x},${shard.y}`;
                                        // Shards unlocked within the last 5 seconds are considered "new"
                                        // Only animate if not already seen
                                        const isRecentlyUnlocked = (Date.now() - shard.timestamp) < 5000;
                                        const shouldAnimate = isRecentlyUnlocked && !seenShardsRef.current.has(shardKey);
                                        
                                        return (
                                            <div
                                                key={`${shard.x}-${shard.y}`}
                                                className={`p-3 hover:bg-slate-50/50 transition-colors flex items-center gap-3 border-b border-slate-100 last:border-0 cursor-pointer ${shouldAnimate ? 'animate-new-shard' : ''}`}
                                                style={shouldAnimate ? { animationDelay: `${index * 50}ms` } : undefined}
                                                onAnimationEnd={() => seenShardsRef.current.add(shardKey)}
                                                onClick={() => {
                                                    // Navigate to shard center
                                                    const centerPx = (shard.x + 0.5) * SHARD_DIMENSION;
                                                    const centerPy = (shard.y + 0.5) * SHARD_DIMENSION;
                                                    const { lat, lon } = globalPxToLatLon(centerPx, centerPy);
                                                    mapRef.current?.setView([lat, lon], 13, { animate: true });

                                                    // Trigger highlight animation after map settles
                                                    setTimeout(() => {
                                                        setHighlightShard({ x: shard.x, y: shard.y });
                                                        // Clear after animation
                                                        setTimeout(() => setHighlightShard(null), 1500);
                                                    }, 300);
                                                }}
                                            >
                                                <div className={`w-8 h-8 rounded-lg shadow-inner border border-emerald-200 bg-linear-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shrink-0 ${shouldAnimate ? 'animate-pop-in' : ''}`}>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                                                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                                                    </svg>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium text-slate-700 truncate">
                                                        {shard.locationName && shard.locationName !== FALLBACK_LOCATION ? (
                                                            <>at {shard.locationName}</>
                                                        ) : (
                                                            <>Shard ({shard.x}, {shard.y})</>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-emerald-500">
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="9 18 15 12 9 6" />
                                                    </svg>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Bottom Toolbar */}
            <div className="absolute bottom-0 left-0 right-0 z-40 p-4">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-2xl overflow-hidden">
                        {/* Toolbar Header */}
                        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between w-full">
                            <div className="flex items-center gap-3 w-full">
                                <button
                                    onClick={() => setIsToolbarExpanded(!isToolbarExpanded)}
                                    className="flex items-center gap-2 text-slate-600 hover:text-slate-800 transition-colors"
                                >
                                    <ChevronIcon direction={isToolbarExpanded ? 'down' : 'up'} />
                                </button>
                                <div className="flex items-center gap-2 text-slate-700 font-medium">
                                    <PaintBrushIcon />
                                    <span>Paint pixel</span>
                                    {(hoveredPixel || selectedPixel) && (
                                        <span className="text-slate-400 text-sm font-mono">
                                            ({(hoveredPixel || selectedPixel)!.px}, {(hoveredPixel || selectedPixel)!.py})
                                        </span>
                                    )}
                                </div>
                                <div className='grow' />
                                <Button variant={"ghost"} size={"icon"} className={cn("", selectedColor === TRANSPARENT_COLOR && "bg-slate-100")} onClick={() => setSelectedColor(TRANSPARENT_COLOR)}>
                                    <Eraser />
                                </Button>
                            </div>

                            <div className="flex items-center gap-2">
                                {/* Share Button */}
                                <button
                                    onClick={handleShare}
                                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                    title="Share location"
                                >
                                    <ShareIcon />
                                </button>
                            </div>
                        </div>

                        {/* Color Palette - hidden in readonly mode */}
                        {isToolbarExpanded && !isReadonly && (
                            <div className="p-4">
                                {/* Two rows of 16 colors each */}
                                <div className="grid grid-cols-8 sm:grid-cols-16 gap-1.5">
                                    {
                                        PRESET_COLORS.map((color) => {
                                            return <Color key={color} color={color} selected={selectedColor === color} onClick={() => setSelectedColor(color)} />
                                        })
                                    }
                                </div>
                            </div>
                        )}

                        {/* Paint Button or Readonly Message */}
                        <div className="px-4 pb-4">
                            {isReadonly ? (
                                <div className="text-center py-2 text-slate-500 text-sm">
                                    <span className="inline-flex items-center gap-2">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                            <circle cx="12" cy="12" r="3" />
                                        </svg>
                                        View-only mode — connect wallet to paint
                                    </span>
                                </div>
                            ) : (
                                <>
                                    {/* <button
                                        onClick={handlePlacePixel}
                                        disabled={!selectedPixel}
                                        className="w-full relative overflow-hidden bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 text-white font-semibold py-3 px-6 rounded-xl transition-all disabled:cursor-not-allowed shadow-lg hover:shadow-xl active:scale-[0.99]"
                                    >
                                        <div className="relative flex items-center justify-center gap-3">
                                            <PaintBrushIcon />
                                            <span>
                                                {!selectedPixel ? 'Select a pixel' : 'Paint'}
                                            </span>
                                        </div>
                                    </button> */}

                                    {/* Help text */}
                                    <div className=" text-center text-xs text-slate-400">
                                        {currentZoom >= PIXEL_SELECT_ZOOM ? (
                                            <span className="text-emerald-500">Click to paint instantly!</span>
                                        ) : (
                                            <span>Zoom in to paint on click</span>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Mute Button */}
            <div className="absolute bottom-6 right-6 z-50 print:hidden flex flex-col gap-2">
                <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setIsSettingsOpen(true)}
                    className="bg-white/90 backdrop-blur shadow-lg hover:bg-white rounded-full h-10 w-10 border border-slate-200"
                    title="Settings"
                >
                    <Settings className="h-5 w-5 text-slate-500" />
                </Button>
                <Button
                    variant="secondary"
                    size="icon"
                    onClick={toggleMute}
                    className="bg-white/90 backdrop-blur shadow-lg hover:bg-white rounded-full h-10 w-10 border border-slate-200"
                    title={isMuted ? "Unmute sounds" : "Mute sounds"}
                >
                    {isMuted ? (
                        <VolumeX className="h-5 w-5 text-slate-500" />
                    ) : (
                        <Volume2 className="h-5 w-5 text-slate-700" />
                    )}
                </Button>
            </div>

            {/* Debug Panel - only visible in development */}
            {process.env.NODE_ENV !== "production" && (
                <div className="absolute bottom-4 left-4 z-50 bg-black/80 text-white text-xs font-mono px-3 py-2 rounded-lg max-h-48 overflow-y-auto">
                    <div>Zoom: {currentZoom.toFixed(1)}</div>
                    {showShardGrid && (
                        <>
                            <div className="mt-1 border-t border-white/20 pt-1">
                                Visible Shards: {visibleShards.length}
                            </div>
                            {visibleShards.length > 0 && (
                                <div className="mt-1 text-[10px] opacity-75 max-h-24 overflow-y-auto">
                                    {visibleShards.map((shard) => (
                                        <div key={`${shard.x}-${shard.y}`}>
                                            ({shard.x}, {shard.y})
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
            <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
            <LocationSearch
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                onLocationSelect={(lat, lon, name, zoomLevel) => {
                    if (mapRef.current) {
                        // Fly to the selected location with dynamic zoom based on location type
                        mapRef.current.flyTo([lat, lon], zoomLevel, {
                            duration: 1.5,
                        });
                        userHasMovedMapRef.current = true;
                        toast.success(`Navigating to ${name}`);
                    }
                }}
            />
        </div>
    );
}

export default PixelCanvas;
