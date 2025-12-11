import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

// Use require for better compatibility with Gun's CommonJS export
const Gun = require('gun');

const PEERS = [
    "http://localhost:8765/gun",
    "https://arweave.tech/gun"
];

// Constants
const PRESENCE_KEY = 'magicplace-presence-v2';
const NICKNAME_STORAGE_KEY = 'magicplace-nickname';
const CLEANUP_INTERVAL_MS = 5000;
const INACTIVE_THRESHOLD_MS = 30000; // 30 seconds timeout
const BROADCAST_THROTTLE_MS = 50; // Broadcast more frequently for smoother updates

export interface PresenceUser {
    id: string;
    name: string; // Display name (nickname or shortened ID)
    lat: number;
    lng: number;
    // Target position for interpolation
    targetLat: number;
    targetLng: number;
    lastSeen: number;
    color: string;
}

// Generate a color from string (consistent)
const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
};

// Lerp function for smooth interpolation
const lerp = (start: number, end: number, t: number) => start + (end - start) * t;

// Get stored nickname
export const getNickname = (): string | null => {
    try {
        return localStorage.getItem(NICKNAME_STORAGE_KEY);
    } catch {
        return null;
    }
};

// Set nickname
export const setNickname = (name: string | null) => {
    try {
        if (name) {
            localStorage.setItem(NICKNAME_STORAGE_KEY, name);
        } else {
            localStorage.removeItem(NICKNAME_STORAGE_KEY);
        }
    } catch {}
};

export function useGunPresence() {
    const { publicKey } = useWallet();
    const [presence, setPresence] = useState<Record<string, PresenceUser>>({});
    const gunRef = useRef<any>(null);
    const myIdRef = useRef<string>(Math.random().toString(36).substr(2, 9));
    const lastBroadcastRef = useRef<number>(0);

    // Initialize Gun and subscribe
    useEffect(() => {
        if (!gunRef.current) {
            gunRef.current = Gun({
                peers: PEERS,
                localStorage: false,
                radisk: false,
                multicast: false
            });

            // Subscribe to presence updates
            const presenceNode = gunRef.current.get(PRESENCE_KEY);
            
            presenceNode.map().on((data: any, id: string) => {
                if (!data || typeof data !== 'object' || !data.lastSeen) return;

                setPresence(prev => {
                    // Skip if we already have newer data
                    if (prev[id] && prev[id].lastSeen >= data.lastSeen) return prev;
                    
                    const existing = prev[id];
                    // Use nickname if provided, otherwise use first 6 chars of ID
                    const displayName = data.name || id.slice(0, 6);
                    
                    return {
                        ...prev,
                        [id]: {
                            id,
                            name: displayName,
                            lat: existing?.lat ?? data.lat,
                            lng: existing?.lng ?? data.lng,
                            targetLat: data.lat,
                            targetLng: data.lng,
                            lastSeen: data.lastSeen,
                            color: data.color || stringToColor(id)
                        }
                    };
                });
            });
        }

        return () => {};
    }, []);

    // Smooth interpolation animation loop
    useEffect(() => {
        let animationFrame: number;
        
        const animate = () => {
            setPresence(prev => {
                let changed = false;
                const next = { ...prev };
                
                Object.keys(next).forEach(key => {
                    const user = next[key];
                    if (!user) return;
                    
                    const newLat = lerp(user.lat, user.targetLat, 0.2);
                    const newLng = lerp(user.lng, user.targetLng, 0.2);
                    
                    if (Math.abs(newLat - user.lat) > 0.00001 || Math.abs(newLng - user.lng) > 0.00001) {
                        next[key] = { ...user, lat: newLat, lng: newLng };
                        changed = true;
                    }
                });
                
                return changed ? next : prev;
            });
            
            animationFrame = requestAnimationFrame(animate);
        };
        
        animationFrame = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrame);
    }, []);

    // Cleanup stale users
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setPresence(prev => {
                let changed = false;
                const next = { ...prev };
                Object.keys(next).forEach(key => {
                    const user = next[key];
                    if (user && now - user.lastSeen > INACTIVE_THRESHOLD_MS) {
                        delete next[key];
                        changed = true;
                    }
                });
                return changed ? next : prev;
            });
        }, CLEANUP_INTERVAL_MS);
        
        return () => clearInterval(interval);
    }, []);

    // Broadcast my presence
    const updateMyPresence = useCallback((lat: number, lng: number) => {
        if (!gunRef.current) return;
        
        const now = Date.now();
        if (now - lastBroadcastRef.current < BROADCAST_THROTTLE_MS) return;
        lastBroadcastRef.current = now;

        const id = publicKey?.toBase58() || myIdRef.current;
        const color = stringToColor(id);
        const nickname = getNickname();
        const displayName = nickname || id.slice(0, 6);

        const data = {
            lat,
            lng,
            lastSeen: now,
            color,
            name: displayName
        };

        gunRef.current.get(PRESENCE_KEY).get(id).put(data);
        
        // Optimistically update local state
        setPresence(prev => ({
            ...prev,
            [id]: { id, name: displayName, lat, lng, targetLat: lat, targetLng: lng, lastSeen: now, color }
        }));
    }, [publicKey]);

    // Derived list for UI
    const onlineUsers = Object.values(presence).sort((a, b) => b.lastSeen - a.lastSeen);

    return {
        onlineUsers,
        updateMyPresence,
        myId: publicKey?.toBase58() || myIdRef.current
    };
}
