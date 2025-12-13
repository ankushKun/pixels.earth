// Shared constants for the MagicPlace application
// These values should match the smart contract and be used across the frontend

// Canvas configuration (must match smart contract)
export const CANVAS_RES = 524288; // 2^19 - pixels per dimension
export const SHARD_DIMENSION = 90; // 90×90 pixels per shard
export const SHARDS_PER_DIM = Math.ceil(CANVAS_RES / SHARD_DIMENSION); // 5826 shards per dimension
export const TILE_SIZE = 512; // Standard tile size
export const MAX_REGION_SIZE = 10000; // Maximum pixels in a region query

// Map configuration
export const DEFAULT_MAP_CENTER: [number, number] = [37.757, -122.4376]; // San Francisco
export const DEFAULT_MAP_ZOOM = 7;
export const MIN_MAP_ZOOM = 3;
export const MAX_MAP_ZOOM = 18;
export const PIXEL_SELECT_ZOOM = 14; // Zoom level when clicking a pixel

// Throttling
export const MAP_MOVE_THROTTLE_MS = 500;

// Special transparent/erase color - placing this sets the pixel to 0 (unset)
// Displayed with a checkered pattern in the UI
export const TRANSPARENT_COLOR = 'TRANSPARENT';

// 8-bit color palette - 32 colors (indexes 1-32 in contract, 0 = transparent)
// Organized as a smooth gradient following the color wheel
export const PRESET_COLORS = [
    // === Reds ===
    '#FF0000', // 1: Pure Red
    '#CC0000', // 2: Dark Red
    '#FF3300', // 3: Red-Orange
    
    // === Oranges ===
    '#FF6600', // 4: Orange
    '#FF9900', // 5: Bright Orange
    '#FFCC00', // 6: Gold/Amber
    
    // === Yellows ===
    '#FFFF00', // 7: Yellow
    '#CCFF00', // 8: Lime Yellow
    
    // === Greens ===
    '#00FF00', // 9: Pure Green
    '#00CC00', // 10: Grass Green
    '#006600', // 11: Forest Green
    '#00FF66', // 12: Spring Green
    
    // === Cyans ===
    '#00FFCC', // 13: Aqua
    '#00FFFF', // 14: Cyan
    '#00CCCC', // 15: Teal
    '#006666', // 16: Dark Teal
    
    // === Blues ===
    '#0099FF', // 17: Sky Blue
    '#0000FF', // 18: Pure Blue
    '#0000CC', // 19: Dark Blue
    
    // === Purples & Pinks ===
    '#6600FF', // 20: Purple
    '#9933FF', // 21: Violet
    '#FF00FF', // 22: Magenta
    '#FF0099', // 23: Hot Pink
    '#FF6699', // 24: Pink
    
    // === Neutrals & Earth Tones ===
    '#FFFFFF', // 25: White
    '#CCCCCC', // 26: Light Gray
    '#888888', // 27: Medium Gray
    '#444444', // 28: Dark Gray
    '#000000', // 29: Black
    '#FFCC99', // 30: Light Skin / Sand
    '#CC9966', // 31: Tan / Brown
    '#663300', // 32: Dark Brown
] as const;

// Web Mercator projection limits
export const MAX_LATITUDE = 85.05112878;
