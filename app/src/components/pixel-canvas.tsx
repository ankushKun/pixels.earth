import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { useMap, type PixelData } from '../hooks/use-map';
import { toast } from 'sonner';
import { hexToUint32, uint32ToHex } from '../lib/colors';
import { latLonToGlobalPx, globalPxToLatLon } from '../lib/projection';
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
import { Brush, Eraser, Grid2X2Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGameSounds } from '../hooks/use-game-sounds';
import { useMagicplaceProgram } from '../hooks/use-magicplace-program';

import { useMagicplaceEvents } from '../hooks/use-magicplace-events';
import { useReadonlyMode } from './start-using';
import { useSessionBalance } from './session-balance-provider';

// Icons as inline SVGs
const PaintBrushIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
        <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </svg>
);

const GridIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="7" x="3" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="14" rx="1" />
        <rect width="7" height="7" x="3" y="14" rx="1" />
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
const MAP_VIEW_STORAGE_KEY = 'magicplace-map-view';

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
                    : "hover:scale-105 hover:shadow opacity-90 hover:opacity-100 ring-1 ring-black/5"
            )}
            style={{ backgroundColor: color }}
            onClick={onClick}
            variant={"ghost"}
        >
                <div className="absolute inset-0 flex items-center justify-center">
                <Brush className={cn("w-5 h-5 bg-blend-darken transition-all duration-200",
                    selected ? "opacity-100" : "opacity-0",
                    color=="#FFFFFF" ? "text-black" : "text-white"
                )} />
                </div>
            <span className="sr-only">Select color {color}</span>
        </Button>
    );
}

export function PixelCanvas() {
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

    // Save map view to localStorage when it changes
    const saveCurrentMapView = useCallback(() => {
        if (mapRef.current) {
            const center = mapRef.current.getCenter();
            const zoom = mapRef.current.getZoom();
            saveMapView([center.lat, center.lng], zoom);
        }
    }, [mapRef]);

    const [selectedColor, setSelectedColor] = useState<string>(PRESET_COLORS[0]);
    const [showRecentPixels, setShowRecentPixels] = useState(true);
    const [isToolbarExpanded, setIsToolbarExpanded] = useState(true);
    const [currentZoom, setCurrentZoom] = useState(DEFAULT_MAP_ZOOM);
    const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
    const [isMapReady, setIsMapReady] = useState(false);
    const [showShardGrid, setShowShardGrid] = useState(false);
    const [shardsAggregated, setShardsAggregated] = useState(false);
    const [visibleShards, setVisibleShards] = useState<{ x: number; y: number }[]>([]);
    const [showRecentShards, setShowRecentShards] = useState(true);
    const [lockedShardAlert, setLockedShardAlert] = useState<{ x: number; y: number } | null>(null);
    const [unlockedShards, setUnlockedShards] = useState<Set<string>>(new Set());
    const [recentUnlockedShards, setRecentUnlockedShards] = useState<{ x: number; y: number; timestamp: number }[]>([]);
    const [highlightShard, setHighlightShard] = useState<{ x: number; y: number } | null>(null);
    const [unlockingShard, setUnlockingShard] = useState<{ x: number; y: number; status: string } | null>(null);

    // Magicplace program hook for checking shard delegation status
    const {
        checkShardDelegation,
        initializeShard,
        estimateShardUnlockCost,
        getAllDelegatedShards,
        placePixelOnER,
        erasePixelOnER,
        getPixelFromShard
    } = useMagicplaceProgram();

    // Readonly mode - hide interactions
    const { isReadonly } = useReadonlyMode();

    // Session balance for transaction checks
    const { checkBalance, refreshBalance } = useSessionBalance();

    // Initial fetch of delegated shards pixels
    const fetchedRef = useRef(false);

    // Fetch recent feed (shards + pixels) from backend
    useEffect(() => {
        if (!isMapReady) return;

        const fetchFeed = async () => {
            try {
                const res = await fetch('/api/feed');
                if (res.ok) {
                    const { pixels, shards } = await res.json();

                    // Update Pixels
                    if (pixels && pixels.length > 0) {
                        const mappedPixels = pixels.map((p: any) => {
                            const colorHex = p.color > 0 ? PRESET_COLORS[p.color - 1] : null;
                            return {
                                px: p.px,
                                py: p.py,
                                color: colorHex ? hexToUint32(colorHex) : 0,
                                timestamp: p.timestamp
                            };
                        });
                        bulkUpdateMarkers(mappedPixels.reverse());
                    }

                    // Update Recent Shards List and Unlocked State
                    if (shards && shards.length > 0) {
                        setRecentUnlockedShards(prev => {
                            const mapped = shards.map((s: any) => ({
                                x: s.shard_x,
                                y: s.shard_y,
                                timestamp: s.timestamp
                            }));
                            const map = new Map();
                            [...mapped, ...prev].forEach(s => map.set(`${s.x},${s.y}`, s));
                            return Array.from(map.values()).sort((a: any, b: any) => b.timestamp - a.timestamp).slice(0, 50);
                        });

                        setUnlockedShards(prev => {
                            const next = new Set(prev);
                            shards.forEach((s: any) => next.add(`${s.shard_x},${s.shard_y}`));
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
        if (fetchedRef.current || isReadonly) return;

        const fetchPixels = async () => {
            // Prevent multiple fetches
            fetchedRef.current = true;

            console.log("Fetching all delegated shards from ER...");
            const shards = await getAllDelegatedShards();
            console.log(`Found ${shards.length} delegated shards`);

            const allPixels: PixelData[] = [];
            const newUnlockedShards = new Set<string>();

            for (const shard of shards) {
                // Mark as unlocked
                newUnlockedShards.add(`${shard.shardX},${shard.shardY}`);

                // Unpack pixels
                const pixels = shard.pixels;
                for (let i = 0; i < pixels.length; i++) {
                    const byte = pixels[i];
                    if (byte === undefined || byte === 0) continue;

                    // Low nibble (ODD index pixel)
                    const p1 = byte & 0x0F;
                    if (p1 !== 0) {
                        const colorHex = PRESET_COLORS[p1 - 1]; // 1-based index
                        if (colorHex) {
                            const localIndex = 2 * i + 1; // Odd
                            const localY = Math.floor(localIndex / SHARD_DIMENSION);
                            const localX = localIndex % SHARD_DIMENSION;

                            allPixels.push({
                                px: shard.shardX * SHARD_DIMENSION + localX,
                                py: shard.shardY * SHARD_DIMENSION + localY,
                                color: hexToUint32(colorHex),
                                timestamp: 0
                            });
                        }
                    }

                    // High nibble (EVEN index pixel)
                    const p2 = (byte >> 4) & 0x0F;
                    if (p2 !== 0) {
                        const colorHex = PRESET_COLORS[p2 - 1]; // 1-based index
                        if (colorHex) {
                            const localIndex = 2 * i; // Even
                            const localY = Math.floor(localIndex / SHARD_DIMENSION);
                            const localX = localIndex % SHARD_DIMENSION;

                            allPixels.push({
                                px: shard.shardX * SHARD_DIMENSION + localX,
                                py: shard.shardY * SHARD_DIMENSION + localY,
                                color: hexToUint32(colorHex),
                                timestamp: 0
                            });
                        }
                    }
                }
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
    }, [getAllDelegatedShards, bulkUpdateMarkers, isReadonly]);

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
    const { playPop, playUnlock, playFail } = useGameSounds();

    // Check if a pixel is in a locked shard
    const isShardLocked = useCallback((px: number, py: number): boolean => {
        const shardX = Math.floor(px / SHARD_DIMENSION);
        const shardY = Math.floor(py / SHARD_DIMENSION);
        const shardKey = `${shardX},${shardY}`;
        // Check if this shard has been unlocked
        return !unlockedShards.has(shardKey);
    }, [unlockedShards]);

    // Zoom to show a locked shard
    const zoomToLockedShard = useCallback((px: number, py: number) => {
        if (!mapRef.current) return;

        const shardX = Math.floor(px / SHARD_DIMENSION);
        const shardY = Math.floor(py / SHARD_DIMENSION);

        // Calculate center of the shard
        const centerPx = (shardX + 0.5) * SHARD_DIMENSION;
        const centerPy = (shardY + 0.5) * SHARD_DIMENSION;
        const { lat, lon } = globalPxToLatLon(centerPx, centerPy);

        // Check if already at approximately zoom 13
        const currentZoomLevel = mapRef.current.getZoom();
        if (Math.abs(currentZoomLevel - 13) < 0.5) {
            // Already at zoom 13, still center and trigger pulse animation
            mapRef.current.setView([lat, lon], 13, { animate: true });
            setLockedShardAlert({ x: shardX, y: shardY });
            // Clear after animation
            setTimeout(() => setLockedShardAlert(null), 600);
        } else {
            // Zoom out to level 13 and center on shard
            mapRef.current.setView([lat, lon], 13, { animate: true });
        }
    }, [mapRef]);

    // Place pixel at coordinates
    const handlePlacePixelAt = useCallback(async (px: number, py: number) => {
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
            } else {
                // Find color index (1-based) for contract
                const colorIndex = PRESET_COLORS.indexOf(selectedColor as any) + 1;

                if (colorIndex <= 0) {
                    throw new Error("Invalid color selected");
                }

                await placePixelOnER(px, py, colorIndex);
                updateMarker(px, py, color);
                toast.success("Pixel placed", { duration: 1500 });
            }

            // Play pop sound
            playPop();
        } catch (e) {
            playFail();
            console.error("Failed to place pixel:", e);
            toast.error("Failed to place pixel: " + (e instanceof Error ? e.message : String(e)));
        }
    }, [selectedColor, updateMarker, removeMarker, playPop, playFail, isShardLocked, placePixelOnER, erasePixelOnER, unlockingShard, zoomToLockedShard]);



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
                `Unlock shard (${shardX}, ${shardY})`
            );
            if (!hasBalance) {
                // Popup will be shown by the provider
                playFail();
                toast.dismiss(toastId);
                setUnlockingShard(null);
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

            // Add to recent unlocked list
            setRecentUnlockedShards(prev => {
                const newShard = { x: shardX, y: shardY, timestamp: Date.now() };
                const filtered = prev.filter(s => !(s.x === shardX && s.y === shardY));
                return [newShard, ...filtered].slice(0, 50); 
            });

        } catch (err) {
            playFail();
            console.error("Failed to unlock shard:", err);
            const errorMessage = err instanceof Error ? err.message : "Failed to unlock shard";
            toast.error(errorMessage, { id: toastId });
        } finally {
            setUnlockingShard(null);
        }
    }, [playPop, playUnlock, playFail, initializeShard, estimateShardUnlockCost, checkBalance, refreshBalance, unlockingShard]);



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

        handlePlacePixelAt(selectedPixel.px, selectedPixel.py);
    }, [selectedPixel, handlePlacePixelAt, isShardLocked, zoomToLockedShard, unlockingShard]);

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
            playFail();
            zoomToLockedShard(px, py);
            return;
        }

        // Check if we should instant place or just select
        const isZoomedIn = currentZoom >= PIXEL_SELECT_ZOOM;

        if (isZoomedIn) {
            // Instant place!
            handlePlacePixelAt(px, py);
        }

        // Update selection and zoom in if needed
        handleMapClick(lat, lng, selectedColor === TRANSPARENT_COLOR ? '#ffffff' : selectedColor);
    }, [currentZoom, handlePlacePixelAt, handleMapClick, selectedColor, isShardLocked, zoomToLockedShard, unlockingShard]);

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
        <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
            {/* Full-screen Map */}
            <MapContainer
                center={initialCenter}
                zoom={initialZoom}
                minZoom={MIN_MAP_ZOOM}
                maxZoom={MAX_MAP_ZOOM}
                className="w-full h-full cursor-crosshair [&_.leaflet-grab]:cursor-crosshair [&_.leaflet-dragging]:cursor-crosshair"
                zoomControl={false}
                worldCopyJump={false}
                maxBounds={[[-90, -180], [90, 180]]}
                maxBoundsViscosity={1.0}
                attributionControl={false}
                scrollWheelZoom={true}
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
                        saveCurrentMapView();
                    }}
                    onZoomEnd={() => {
                        throttledAction();
                        saveCurrentMapView();
                        if (mapRef.current) {
                            setCurrentZoom(mapRef.current.getZoom());
                        }
                    }}
                    onMouseMove={(lat, lng) => handleMapHover(lat, lng, selectedColor === TRANSPARENT_COLOR ? '#ffffff' : selectedColor)}
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
                />
            </MapContainer>

            {/* Shard Grid Zoom Hint */}
            {showShardGrid && shardsAggregated && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
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
                <button
                    onClick={() => {
                        if (localPixels.length > 0 && mapRef.current) {
                            const bounds = mapRef.current.getBounds();

                            // Filter placed pixels that are NOT in the current view
                            const pixelsOutsideView = localPixels.filter(pixel => {
                                const { lat, lon } = globalPxToLatLon(pixel.px, pixel.py);
                                return !bounds.contains([lat, lon]);
                            });

                            // Pick from pixels outside view, or any pixel if all are visible
                            const targetPixels = pixelsOutsideView.length > 0 ? pixelsOutsideView : localPixels;
                            const randomPixel = targetPixels[Math.floor(Math.random() * targetPixels.length)];
                            if (!randomPixel) return;
                            focusOnPixel(randomPixel.px, randomPixel.py);
                        } else if (localPixels.length === 0) {
                            alert('No pixels placed yet. Be the first to place a pixel!');
                        }
                    }}
                    className="w-8 h-8 bg-white rounded-lg shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-colors"
                    title="Explore placed pixels"
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
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="3" y1="15" x2="21" y2="15" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                        <line x1="15" y1="3" x2="15" y2="21" />
                    </svg>
                </button>
            </div>

            {/* Top Right - Info */}
            <div className="absolute top-4 right-4 flex items-center gap-3 z-40">

                {/* Shards Count - Toggle for Recent Shard unlocks */}
                <button
                    onClick={() => setShowRecentShards(!showRecentShards)}
                    className={`backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 transition-colors ${showRecentShards
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'bg-white/90 text-slate-700 hover:bg-white'
                        }`}
                    title="Toggle recent shards"
                >
                    <Grid2X2Plus className="w-4.5 h-4.5" />
                    <span>{unlockedShards.size.toLocaleString()}</span>
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
                    <GridIcon />
                    <span>{placedPixelCount.toLocaleString()}</span>
                </button>

                <WalletConnect onMenuOpenChange={setIsWalletMenuOpen} />
            </div>

            {/* Panels Container - Right side */}
            {!isWalletMenuOpen && (showRecentPixels || showRecentShards) && (
                <div className="absolute top-16 right-4 z-40 flex flex-col gap-3 max-h-[calc(100vh-200px)]">
                    {/* Recent Pixels Panel */}
                    {showRecentPixels && (
                        <div className="w-72 bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-64">
                            <div className="p-3 border-b border-slate-200 font-semibold text-slate-700 flex items-center justify-between shrink-0">
                                <span>Recent Pixels</span>
                                <button onClick={() => setShowRecentPixels(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                            </div>
                            <div className="overflow-y-auto flex-1">
                                {localPixels.length === 0 ? (
                                    <div className="p-4 text-center text-slate-400 text-sm">
                                        No pixels placed yet. Click on the map to start painting!
                                    </div>
                                ) : (
                                    localPixels.slice(0, 20).map((pixel) => {
                                        const isTransparent = pixel.color === 0;
                                        return (
                                            <div
                                                key={`${pixel.px}-${pixel.py}-${pixel.timestamp}`}
                                                className="p-3 hover:bg-slate-50 cursor-pointer transition-colors flex items-center gap-3 border-b border-slate-100 last:border-0"
                                                onClick={() => {
                                                    focusOnPixel(pixel.px, pixel.py);
                                                }}
                                            >
                                                <div
                                                    className="w-8 h-8 rounded-lg shadow-inner border border-slate-200"
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
                                                <div>
                                                    <div className="text-sm font-medium text-slate-700">
                                                        ({pixel.px}, {pixel.py})
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
                        <div className="w-72 bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-64">
                            <div className="p-3 border-b border-slate-200 font-semibold text-slate-700 flex items-center justify-between shrink-0">
                                <span className="flex items-center gap-2">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                                    </svg>
                                    Unlocked Shards
                                </span>
                                <button onClick={() => setShowRecentShards(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                            </div>
                            <div className="overflow-y-auto flex-1">
                                {recentUnlockedShards.length === 0 ? (
                                    <div className="p-4 text-center text-slate-400 text-sm">
                                        No shards unlocked yet. Hover over shards and click "Unlock" to start!
                                    </div>
                                ) : (
                                    recentUnlockedShards.slice(0, 20).map((shard) => {
                                        return (
                                            <div
                                                key={`${shard.x}-${shard.y}`}
                                                className="p-3 hover:bg-slate-50 cursor-pointer transition-colors flex items-center gap-3 border-b border-slate-100 last:border-0"
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
                                                <div className="w-8 h-8 rounded-lg shadow-inner border border-emerald-200 bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                                                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                                                    </svg>
                                                </div>
                                                <div className="flex-1">
                                                    <div className="text-sm font-medium text-slate-700">
                                                        Shard ({shard.x}, {shard.y})
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
                    <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
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
                                <div className="grid grid-cols-15 gap-1.5">
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

            {/* Debug Panel - only visible in development */}
            {import.meta.env.DEV && (
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
        </div>
    );
}

export default PixelCanvas;
