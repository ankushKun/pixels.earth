/**
 * Server-side reverse geocoding with SQLite database cache
 * Uses shared core logic from geocode-core.ts
 */

import db from "./db";
import { globalPxToLatLon } from "../lib/projection";
import {
    LAND_GRID_PRECISION,
    OCEAN_GRID_PRECISION,
    MIN_REQUEST_INTERVAL,
    getGridKey,
    getNearbyGridKeys,
    fetchLocationFromAPI,
    FALLBACK_LOCATION,
} from "../lib/geocode-core";

// Rate limiting state
let lastRequestTime = 0;

/**
 * Check database cache for nearby location
 */
function findCachedLocation(lat: number, lon: number): string | null {
    // Check exact grid cell first
    const exactKey = getGridKey(lat, lon);
    const exact = db.prepare('SELECT location_name FROM location_cache WHERE grid_key = ?').get(exactKey) as { location_name: string } | undefined;
    if (exact) {
        return exact.location_name;
    }
    
    // Check nearby grid cells
    const nearbyKeys = getNearbyGridKeys(lat, lon);
    for (const key of nearbyKeys) {
        const cached = db.prepare('SELECT location_name FROM location_cache WHERE grid_key = ?').get(key) as { location_name: string } | undefined;
        if (cached) {
            return cached.location_name;
        }
    }
    
    // Check with ocean precision
    const oceanKey = getGridKey(lat, lon, OCEAN_GRID_PRECISION);
    const oceanCached = db.prepare('SELECT location_name FROM location_cache WHERE grid_key = ?').get(oceanKey) as { location_name: string } | undefined;
    if (oceanCached) {
        return oceanCached.location_name;
    }
    
    return null;
}

/**
 * Store location in database cache
 */
function cacheLocation(lat: number, lon: number, locationName: string, isWaterBody: boolean): void {
    const precision = isWaterBody ? OCEAN_GRID_PRECISION : LAND_GRID_PRECISION;
    const key = getGridKey(lat, lon, precision);
    
    try {
        db.prepare(`
            INSERT OR REPLACE INTO location_cache (grid_key, location_name, is_water_body, created_at)
            VALUES (?, ?, ?, ?)
        `).run(key, locationName, isWaterBody ? 1 : 0, Date.now());
    } catch (e) {
        // Ignore cache errors
    }
}

/**
 * Wait for rate limit
 */
async function waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
    }
    lastRequestTime = Date.now();
}

/**
 * Get location name for coordinates with persistent database caching
 * Uses shared core logic for API calls and formatting
 */
export async function getLocationNameCached(lat: number, lon: number): Promise<string> {
    // Check database cache first
    const cached = findCachedLocation(lat, lon);
    if (cached) {
        return cached;
    }
    
    try {
        await waitForRateLimit();
        
        const result = await fetchLocationFromAPI(lat, lon);
        
        if (!result) {
            cacheLocation(lat, lon, FALLBACK_LOCATION, false);
            return FALLBACK_LOCATION;
        }
        
        // Cache and return the formatted display name
        cacheLocation(lat, lon, result.displayName, result.placeInfo.isWaterBody);
        return result.displayName;
        
    } catch (error) {
        console.warn('Geocoding failed:', error);
        cacheLocation(lat, lon, FALLBACK_LOCATION, false);
        return FALLBACK_LOCATION;
    }
}

/**
 * Get location name for pixel coordinates
 */
export async function getLocationForPixel(px: number, py: number): Promise<string> {
    const { lat, lon } = globalPxToLatLon(px, py);
    return getLocationNameCached(lat, lon);
}

/**
 * Get location name for shard coordinates (uses shard center)
 */
export async function getLocationForShard(shardX: number, shardY: number, shardDimension: number): Promise<string> {
    const centerPx = (shardX + 0.5) * shardDimension;
    const centerPy = (shardY + 0.5) * shardDimension;
    const { lat, lon } = globalPxToLatLon(centerPx, centerPy);
    return getLocationNameCached(lat, lon);
}
