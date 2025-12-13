/**
 * Shared reverse geocoding core logic
 * Used by both frontend and backend with different caching strategies
 */

// Grid precision for caching (in degrees)
// 0.02 degrees ≈ 2.2km at equator - more precise city lookups
export const LAND_GRID_PRECISION = 0.02;
// 1 degree ≈ 111km at equator - good for oceans
export const OCEAN_GRID_PRECISION = 1.0;

// Rate limiting: Nominatim requires max 1 request per second
export const MIN_REQUEST_INTERVAL = 650; // Reduced to 0.65s for better UX

export interface NominatimResponse {
    address?: {
        city?: string;
        town?: string;
        village?: string;
        hamlet?: string;
        municipality?: string;
        county?: string;
        state?: string;
        country?: string;
        ocean?: string;
        sea?: string;
        bay?: string;
        water?: string;
        natural?: string;
    };
    display_name?: string;
    name?: string;
    type?: string;
    error?: string;
}

export interface PlaceInfo {
    name: string;
    region?: string;
    country?: string;
    fullName: string;
    isWaterBody: boolean;
}

/**
 * Get a grid-based cache key for coordinates
 * Groups nearby coordinates to the same grid cell
 */
export function getGridKey(lat: number, lon: number, precision: number = LAND_GRID_PRECISION): string {
    const gridLat = Math.round(lat / precision) * precision;
    const gridLon = Math.round(lon / precision) * precision;
    return `${gridLat.toFixed(2)},${gridLon.toFixed(2)}`;
}

/**
 * Get all nearby grid keys (current + 8 surrounding cells)
 * Used to find cached locations from nearby coordinates
 */
export function getNearbyGridKeys(lat: number, lon: number, precision: number = LAND_GRID_PRECISION): string[] {
    const keys: string[] = [];
    const offsets = [-precision, 0, precision];
    
    for (const latOffset of offsets) {
        for (const lonOffset of offsets) {
            const gridLat = Math.round((lat + latOffset) / precision) * precision;
            const gridLon = Math.round((lon + lonOffset) / precision) * precision;
            keys.push(`${gridLat.toFixed(2)},${gridLon.toFixed(2)}`);
        }
    }
    
    return keys;
}

/**
 * Format location data into a display string
 * Returns "City, Country" or "City, State" for US
 */
export function formatLocationName(data: NominatimResponse): { displayName: string; placeInfo: PlaceInfo } {
    // Check for water body first
    const waterBodyName = 
        data.address?.ocean ||
        data.address?.sea ||
        data.address?.bay ||
        data.address?.water ||
        (data.type === 'ocean' || data.type === 'sea' ? data.name : null);
    
    if (waterBodyName) {
        return {
            displayName: waterBodyName,
            placeInfo: {
                name: waterBodyName,
                fullName: waterBodyName,
                isWaterBody: true,
            }
        };
    }
    
    if (!data.address) {
        return {
            displayName: "Secret Location",
            placeInfo: {
                name: "Secret Location",
                fullName: "Secret Location",
                isWaterBody: false,
            }
        };
    }
    
    // Get the most specific land place name available (city-level)
    const cityName = 
        data.address.city ||
        data.address.town ||
        data.address.village ||
        data.address.hamlet ||
        data.address.municipality ||
        null;
    
    // Get region/state level
    const regionName = data.address.state || data.address.county || null;
    
    // Get country
    const countryName = data.address.country || null;
    
    // Build the display name - prioritize "City, Country/State" format
    let displayName: string;
    
    if (cityName) {
        // We have a city - format as "City, Country" or "City, State" for US
        if (countryName === 'United States' && regionName) {
            displayName = `${cityName}, ${regionName}`;
        } else if (countryName) {
            displayName = `${cityName}, ${countryName}`;
        } else if (regionName) {
            displayName = `${cityName}, ${regionName}`;
        } else {
            displayName = cityName;
        }
    } else if (regionName) {
        // No city, but have region - format as "Region, Country"
        if (countryName && regionName !== countryName) {
            displayName = `${regionName}, ${countryName}`;
        } else {
            displayName = regionName;
        }
    } else if (countryName) {
        // Only country available
        displayName = countryName;
    } else {
        displayName = 'Unknown location';
    }
    
    const placeInfo: PlaceInfo = {
        name: cityName || regionName || countryName || 'Unknown location',
        region: regionName || undefined,
        country: countryName || undefined,
        fullName: data.display_name || displayName,
        isWaterBody: false,
    };
    
    return { displayName, placeInfo };
}

/**
 * Make a reverse geocoding API call to Nominatim
 * Falls back to ocean name detection for water coordinates
 * Throws on network errors so caller can handle retries
 */
export async function fetchLocationFromAPI(lat: number, lon: number): Promise<{ displayName: string; placeInfo: PlaceInfo } | null> {
    // Use zoom=18 for maximum detail (city/town level)
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'MagicPlace/1.0 (https://magicplace.app)',
        },
    });
    
    if (!response.ok) {
        // Try ocean name fallback for water coordinates
        const oceanName = getOceanName(lat, lon);
        return {
            displayName: oceanName,
            placeInfo: createOceanPlaceInfo(oceanName),
        };
    }
    
    const data: NominatimResponse = await response.json();
    
    if (data.error) {
        // Nominatim returned an error (likely no data for this location)
        // Try ocean name fallback
        const oceanName = getOceanName(lat, lon);
        return {
            displayName: oceanName,
            placeInfo: createOceanPlaceInfo(oceanName),
        };
    }
    
    return formatLocationName(data);
}

/**
 * Default fallback for when geocoding fails
 */
export const FALLBACK_LOCATION = "Secret Location";

/**
 * Get ocean/sea name based on coordinates
 * Used as fallback when Nominatim doesn't return useful water body data
 */
export function getOceanName(lat: number, lon: number): string {
    // Arctic Ocean (north of ~66°N)
    if (lat > 66) {
        return "Arctic Ocean";
    }
    
    // Southern Ocean (south of ~60°S)
    if (lat < -60) {
        return "Southern Ocean";
    }
    
    // Pacific Ocean
    // Western Pacific: roughly lon > 100° or lon < -100°
    if (lon > 100 || lon < -100) {
        // Check for specific seas
        if (lat > 20 && lat < 45 && lon > 100 && lon < 145) {
            return "Sea of Japan";
        }
        if (lat > 0 && lat < 25 && lon > 100 && lon < 130) {
            return "South China Sea";
        }
        if (lat > 20 && lat < 35 && lon > 120 && lon < 135) {
            return "East China Sea"; 
        }
        if (lat > 50 && lat < 66 && lon > 160 && lon < 180) {
            return "Bering Sea";
        }
        if (lat > 50 && lat < 66 && lon > -180 && lon < -160) {
            return "Bering Sea";
        }
        return lat > 0 ? "North Pacific Ocean" : "South Pacific Ocean";
    }
    
    // Atlantic Ocean
    // Roughly between lon -80° and lon 0° (with some exceptions)
    if (lon > -80 && lon < 0) {
        // Caribbean Sea
        if (lat > 9 && lat < 22 && lon > -85 && lon < -60) {
            return "Caribbean Sea";
        }
        // Gulf of Mexico
        if (lat > 18 && lat < 31 && lon > -98 && lon < -80) {
            return "Gulf of Mexico";
        }
        // Mediterranean (between Africa and Europe)
        if (lat > 30 && lat < 46 && lon > -6 && lon < 0) {
            return "Mediterranean Sea";
        }
        // North Sea
        if (lat > 51 && lat < 62 && lon > -4 && lon < 10) {
            return "North Sea";
        }
        // Baltic Sea
        if (lat > 53 && lat < 66 && lon > 10 && lon < 30) {
            return "Baltic Sea";
        }
        return lat > 0 ? "North Atlantic Ocean" : "South Atlantic Ocean";
    }
    
    // Mediterranean & Black Sea region
    if (lat > 30 && lat < 46 && lon >= 0 && lon < 42) {
        if (lon > 26 && lat > 40 && lat < 47) {
            return "Black Sea";
        }
        return "Mediterranean Sea";
    }
    
    // Indian Ocean
    // Roughly lon 20° to 100°, south of ~25°N
    if (lon >= 20 && lon <= 100) {
        // Arabian Sea
        if (lat > 5 && lat < 25 && lon > 50 && lon < 78) {
            return "Arabian Sea";
        }
        // Bay of Bengal
        if (lat > 5 && lat < 23 && lon > 78 && lon < 100) {
            return "Bay of Bengal";
        }
        // Red Sea
        if (lat > 12 && lat < 30 && lon > 32 && lon < 44) {
            return "Red Sea";
        }
        // Persian Gulf
        if (lat > 24 && lat < 30 && lon > 48 && lon < 57) {
            return "Persian Gulf";
        }
        if (lat < 25) {
            return "Indian Ocean";
        }
    }
    
    // Default fallback
    return "International Waters";
}

/**
 * Create a PlaceInfo object for an ocean/water body
 */
export function createOceanPlaceInfo(oceanName: string): PlaceInfo {
    return {
        name: oceanName,
        fullName: oceanName,
        isWaterBody: true,
    };
}
