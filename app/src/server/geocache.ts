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

// Maximum retry attempts for network failures
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds

/**
 * Get location name for coordinates with persistent database caching
 * Uses shared core logic for API calls and formatting
 * Retries with exponential backoff on network failures
 */
export async function getLocationNameCached(lat: number, lon: number): Promise<string> {
    // Check database cache first
    const cached = findCachedLocation(lat, lon);
    if (cached) {
        return cached;
    }
    
    let lastError: any = null;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            await waitForRateLimit();
            
            const result = await fetchLocationFromAPI(lat, lon);
            
            if (!result) {
                // API returned null but didn't throw - this means geocoding couldn't find data
                // DON'T cache the fallback - let it retry next time in case it was a transient issue
                return FALLBACK_LOCATION;
            }
            
            // Cache and return the formatted display name
            cacheLocation(lat, lon, result.displayName, result.placeInfo.isWaterBody);
            return result.displayName;
            
        } catch (error: any) {
            lastError = error;
            const isNetworkError = error?.code === 'ConnectionRefused' || 
                                   error?.code === 'ECONNREFUSED' ||
                                   error?.code === 'ETIMEDOUT' ||
                                   error?.code === 'ENOTFOUND' ||
                                   error?.message?.includes('Unable to connect') ||
                                   error?.message?.includes('fetch failed') ||
                                   error?.message?.includes('network');
            
            if (isNetworkError && attempt < MAX_RETRIES - 1) {
                // Retry with exponential backoff for network errors
                const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
                console.warn(`Geocoding network error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            // Non-network error or max retries reached
            console.warn(`Geocoding failed after ${attempt + 1} attempts:`, error);
            
            // DON'T cache the fallback for network errors - let it retry next time
            if (isNetworkError) {
                console.warn('Network error - NOT caching fallback location, will retry on next request');
                throw new Error(`Geocoding temporarily unavailable: ${error?.message || 'network error'}`);
            }
            
            // For non-network errors (e.g., parsing errors), still don't cache the fallback
            // This allows retries on subsequent requests
            return FALLBACK_LOCATION;
        }
    }
    
    // Should not reach here, but just in case
    console.warn('Geocoding: max retries exceeded');
    throw new Error(`Geocoding failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'unknown error'}`);
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
