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
export const PIXEL_SELECT_ZOOM = 15; // Zoom level when clicking a pixel

// Throttling
export const MAP_MOVE_THROTTLE_MS = 500;

// Special transparent/erase color - placing this sets the pixel to 0 (unset)
// Displayed with a checkered pattern in the UI
export const TRANSPARENT_COLOR = 'TRANSPARENT';

// 8-bit color palette - 32 colors (indexes 1-32 in contract, 0 = transparent)
// Expanded palette with more variety for creative expression
export const PRESET_COLORS = [
    // Row 1: Basic colors
    '#000000', // 1: Black
    '#FFFFFF', // 2: White
    '#FF0000', // 3: Red
    '#00FF00', // 4: Green
    '#0000FF', // 5: Blue
    '#FFFF00', // 6: Yellow
    '#FF00FF', // 7: Magenta
    '#00FFFF', // 8: Cyan
    // Row 2: Warm colors
    '#FF8000', // 9: Orange
    '#FF4500', // 10: Red-Orange
    '#FFD700', // 11: Gold
    '#FFA500', // 12: Bright Orange
    '#FF6347', // 13: Tomato
    '#DC143C', // 14: Crimson
    '#B22222', // 15: Firebrick
    '#8B0000', // 16: Dark Red
    // Row 3: Cool colors  
    '#8000FF', // 17: Purple
    '#4B0082', // 18: Indigo
    '#6A5ACD', // 19: Slate Blue
    '#00CED1', // 20: Dark Cyan
    '#20B2AA', // 21: Light Sea Green
    '#008B8B', // 22: Dark Cyan
    '#006400', // 23: Dark Green
    '#228B22', // 24: Forest Green
    // Row 4: Pastels & neutrals
    '#00FF80', // 25: Mint
    '#FF0080', // 26: Pink
    '#FF69B4', // 27: Hot Pink
    '#DDA0DD', // 28: Plum
    '#808080', // 29: Gray
    '#A9A9A9', // 30: Dark Gray
    '#804000', // 31: Brown
    '#008080', // 32: Teal
] as const;

// Web Mercator projection limits
export const MAX_LATITUDE = 85.05112878;
