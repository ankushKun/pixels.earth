/**
 * Frontend reverse geocoding with localStorage cache
 * Uses shared core logic from geocode-core.ts
 */

import {
    LAND_GRID_PRECISION,
    OCEAN_GRID_PRECISION,
    MIN_REQUEST_INTERVAL,
    getGridKey,
    getNearbyGridKeys,
    fetchLocationFromAPI,
    formatLocationName,
    FALLBACK_LOCATION,
    type PlaceInfo,
} from './geocode-core';

import { globalPxToLatLon } from './projection';

// Re-export for convenience
export { getGridKey, type PlaceInfo };

// Grid-based cache for location names (indexed by grid cell)
const geocodeCache = new Map<string, PlaceInfo>();

// Quick string cache: maps grid key directly to location name string
const locationNameCache = new Map<string, string>();

// LocalStorage key for persisting cache
const CACHE_STORAGE_KEY = 'magicplace_geocode_cache';

// Load cache from localStorage on initialization
function loadCacheFromStorage(): void {
    if (typeof window === 'undefined') return; // SSR guard
    
    try {
        const stored = localStorage.getItem(CACHE_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored) as Record<string, string>;
            Object.entries(parsed).forEach(([key, name]) => {
                locationNameCache.set(key, name);
            });
            console.log(`📍 Loaded ${locationNameCache.size} cached locations from storage`);
        }
    } catch (e) {
        // Ignore parse errors
    }
}

// Save cache to localStorage
function saveCacheToStorage(): void {
    if (typeof window === 'undefined') return; // SSR guard
    
    try {
        const obj: Record<string, string> = {};
        locationNameCache.forEach((value, key) => {
            obj[key] = value;
        });
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
        // Ignore storage errors (quota exceeded, etc.)
    }
}

// Initialize cache from storage
loadCacheFromStorage();

/**
 * Check if a cached location is nearby - returns cached value if found
 * Checks both in-memory cache and localStorage-loaded cache
 */
function findNearbyCache(lat: number, lon: number): { place: PlaceInfo | null; name: string | null } {
    const exactKey = getGridKey(lat, lon);
    if (geocodeCache.has(exactKey)) {
        return { place: geocodeCache.get(exactKey)!, name: locationNameCache.get(exactKey) || null };
    }
    if (locationNameCache.has(exactKey)) {
        return { place: null, name: locationNameCache.get(exactKey)! };
    }
    
    const nearbyKeys = getNearbyGridKeys(lat, lon);
    for (const key of nearbyKeys) {
        if (geocodeCache.has(key)) {
            return { place: geocodeCache.get(key)!, name: locationNameCache.get(key) || null };
        }
        if (locationNameCache.has(key)) {
            return { place: null, name: locationNameCache.get(key)! };
        }
    }
    
    const oceanKey = getGridKey(lat, lon, OCEAN_GRID_PRECISION);
    if (geocodeCache.has(oceanKey)) {
        return { place: geocodeCache.get(oceanKey)!, name: locationNameCache.get(oceanKey) || null };
    }
    if (locationNameCache.has(oceanKey)) {
        return { place: null, name: locationNameCache.get(oceanKey)! };
    }
    
    return { place: null, name: null };
}

/**
 * Store a location in both caches and persist to localStorage
 */
function cacheLocation(lat: number, lon: number, place: PlaceInfo, locationName: string): void {
    const precision = place.isWaterBody ? OCEAN_GRID_PRECISION : LAND_GRID_PRECISION;
    const key = getGridKey(lat, lon, precision);
    geocodeCache.set(key, place);
    locationNameCache.set(key, locationName);
    saveCacheToStorage();
}

/**
 * Reverse geocode coordinates to get place name
 * Uses shared core logic for API calls and formatting
 */
export async function reverseGeocode(lat: number, lon: number): Promise<PlaceInfo | null> {
    // Check cache first
    const cached = findNearbyCache(lat, lon);
    if (cached.place) {
        return cached.place;
    }
    
    // NO RATE LIMIT - shoot parallel requests!
    try {
        const result = await fetchLocationFromAPI(lat, lon);
        
        if (!result) {
            const fallbackPlace: PlaceInfo = {
                name: FALLBACK_LOCATION,
                fullName: FALLBACK_LOCATION,
                isWaterBody: false,
            };
            return fallbackPlace;
        }
        
        cacheLocation(lat, lon, result.placeInfo, result.displayName);
        return result.placeInfo;
    } catch (error) {
        console.warn('Reverse geocoding failed:', error);
        return null;
    }
}


/**
 * Get a short, human-readable location string
 * Uses aggressive caching to minimize API calls
 */
export async function getLocationName(lat: number, lon: number): Promise<string> {
    // Check quick string cache first (including nearby cells)
    const cached = findNearbyCache(lat, lon);
    if (cached.name) {
        return cached.name;
    }
    
    const place = await reverseGeocode(lat, lon);
    
    if (!place) {
        return FALLBACK_LOCATION;
    }

    // Water bodies use name directly
    if (place.isWaterBody) {
        return place.name;
    }
    
    // Build a concise name: "City, Country" or "City, State" for US
    let locationName: string;
    
    if (place.name && place.name !== place.country && place.name !== place.region) {
        if (place.country === 'United States' && place.region) {
            locationName = `${place.name}, ${place.region}`;
        } else if (place.country) {
            locationName = `${place.name}, ${place.country}`;
        } else if (place.region) {
            locationName = `${place.name}, ${place.region}`;
        } else {
            locationName = place.name;
        }
    } else if (place.region && place.region !== place.country) {
        if (place.country) {
            locationName = `${place.region}, ${place.country}`;
        } else {
            locationName = place.region;
        }
    } else {
        locationName = place.country || place.name || 'Unknown location';
    }
    
    return locationName;
}

/**
 * Get location name for pixel coordinates
 */
export async function getLocationForPixel(px: number, py: number): Promise<string> {
    const { lat, lon } = globalPxToLatLon(px, py);
    return getLocationName(lat, lon);
}

/**
 * Get cache statistics (useful for debugging)
 */
export function getCacheStats(): { entries: number; size: string } {
    return {
        entries: geocodeCache.size,
        size: `${locationNameCache.size} location strings cached`
    };
}
