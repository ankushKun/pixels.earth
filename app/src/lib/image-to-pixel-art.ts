/**
 * Image to Pixel Art Converter
 * Converts uploaded images to low-resolution pixel art using the available color palette
 */

import { PRESET_COLORS } from '../constants';

// RGB color interface
interface RGB {
  r: number;
  g: number;
  b: number;
}

// Pixel art result
export interface PixelArtData {
  width: number;
  height: number;
  // 2D array of color indices (1-based for non-transparent, 0 for transparent)
  pixels: number[][];
  // Preview canvas data URL for display
  previewDataUrl: string;
}

// Parse hex color to RGB
function hexToRgb(hex: string): RGB {
  const cleaned = hex.replace('#', '');
  return {
    r: parseInt(cleaned.substring(0, 2), 16),
    g: parseInt(cleaned.substring(2, 4), 16),
    b: parseInt(cleaned.substring(4, 6), 16),
  };
}

// Pre-compute palette RGB values for faster matching
const PALETTE_RGB: RGB[] = PRESET_COLORS.map(hexToRgb);

/**
 * Calculate the color distance using a weighted formula
 * Human eyes are more sensitive to green, less to blue
 * Using the "redmean" approximation for better perceptual color matching
 */
function colorDistance(c1: RGB, c2: RGB): number {
  const rMean = (c1.r + c2.r) / 2;
  const dR = c1.r - c2.r;
  const dG = c1.g - c2.g;
  const dB = c1.b - c2.b;
  
  // Weighted by human color perception
  const rWeight = 2 + rMean / 256;
  const gWeight = 4;
  const bWeight = 2 + (255 - rMean) / 256;
  
  return Math.sqrt(rWeight * dR * dR + gWeight * dG * dG + bWeight * dB * dB);
}

/**
 * Find the closest color in the palette
 * Returns 1-based index (contract uses 1-32, 0 = transparent)
 * Pixels with alpha < 50 (~20% opacity) are treated as fully transparent
 */
function findClosestPaletteColor(color: RGB, alpha: number): number {
  // If mostly transparent, return 0 (transparent/skip this pixel)
  // Using threshold of 50 to preserve semi-transparent elements while ignoring nearly invisible ones
  if (alpha < 50) {
    return 0;
  }
  
  let minDistance = Infinity;
  let closestIndex = 0;
  
  for (let i = 0; i < PALETTE_RGB.length; i++) {
    const distance = colorDistance(color, PALETTE_RGB[i]!);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }
  
  return closestIndex + 1; // 1-based index for contract
}

/**
 * Apply ordered dithering (Bayer matrix 4x4) for better visual results
 * This helps create the illusion of more colors
 */
const BAYER_MATRIX_4X4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

function applyDithering(x: number, y: number, color: RGB, strength: number = 0.15): RGB {
  const matrixValue = BAYER_MATRIX_4X4[y % 4]![x % 4]!;
  const threshold = (matrixValue / 16 - 0.5) * strength * 255;
  
  return {
    r: Math.max(0, Math.min(255, color.r + threshold)),
    g: Math.max(0, Math.min(255, color.g + threshold)),
    b: Math.max(0, Math.min(255, color.b + threshold)),
  };
}

/**
 * Convert an image file to pixel art
 * 
 * @param imageFile - The uploaded image file
 * @param maxSize - Maximum width or height (default 32)
 * @param useDithering - Whether to apply dithering for better color matching
 * @returns PixelArtData with processed pixels and preview
 */
export async function convertImageToPixelArt(
  imageFile: File,
  maxSize: number = 32,
  useDithering: boolean = true
): Promise<PixelArtData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    
    reader.onload = (e) => {
      img.onload = () => {
        try {
          const result = processImage(img, maxSize, useDithering);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(imageFile);
  });
}

/**
 * Convert an image URL to pixel art
 */
export async function convertImageUrlToPixelArt(
  imageUrl: string,
  maxSize: number = 32,
  useDithering: boolean = true
): Promise<PixelArtData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      try {
        const result = processImage(img, maxSize, useDithering);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}

/**
 * Process the image and convert to pixel art
 */
function processImage(img: HTMLImageElement, maxSize: number, useDithering: boolean): PixelArtData {
  // Calculate target dimensions maintaining aspect ratio
  let targetWidth: number;
  let targetHeight: number;
  
  if (img.width >= img.height) {
    targetWidth = Math.min(maxSize, img.width);
    targetHeight = Math.round((targetWidth / img.width) * img.height);
  } else {
    targetHeight = Math.min(maxSize, img.height);
    targetWidth = Math.round((targetHeight / img.height) * img.width);
  }
  
  // Ensure minimum size of 1
  targetWidth = Math.max(1, targetWidth);
  targetHeight = Math.max(1, targetHeight);
  
  // Create a canvas to sample the image at target resolution
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = targetWidth;
  sampleCanvas.height = targetHeight;
  const sampleCtx = sampleCanvas.getContext('2d')!;
  
  // Use pixelated rendering for nearest-neighbor sampling
  sampleCtx.imageSmoothingEnabled = false;
  sampleCtx.drawImage(img, 0, 0, targetWidth, targetHeight);
  
  // Get pixel data
  const imageData = sampleCtx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imageData.data;
  
  // Convert each pixel to palette color
  const pixels: number[][] = [];
  
  for (let y = 0; y < targetHeight; y++) {
    const row: number[] = [];
    for (let x = 0; x < targetWidth; x++) {
      const idx = (y * targetWidth + x) * 4;
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      const a = data[idx + 3]!;
      
      let color: RGB = { r, g, b };
      
      // Apply dithering if enabled (only on non-transparent pixels)
      if (useDithering && a >= 50) {
        color = applyDithering(x, y, color);
      }
      
      const colorIndex = findClosestPaletteColor(color, a);
      row.push(colorIndex);
    }
    pixels.push(row);
  }
  
  // Generate preview image
  const previewScale = Math.max(1, Math.floor(256 / Math.max(targetWidth, targetHeight)));
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = targetWidth * previewScale;
  previewCanvas.height = targetHeight * previewScale;
  const previewCtx = previewCanvas.getContext('2d')!;
  
  // Draw each pixel as a colored square
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const colorIndex = pixels[y]![x]!;
      if (colorIndex === 0) {
        // Transparent - draw checkerboard pattern
        const isLight = (x + y) % 2 === 0;
        previewCtx.fillStyle = isLight ? '#e0e0e0' : '#c0c0c0';
      } else {
        previewCtx.fillStyle = PRESET_COLORS[colorIndex - 1]!;
      }
      previewCtx.fillRect(x * previewScale, y * previewScale, previewScale, previewScale);
    }
  }
  
  // Add grid lines for clarity if scale is large enough
  if (previewScale >= 4) {
    previewCtx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    previewCtx.lineWidth = 1;
    for (let x = 0; x <= targetWidth; x++) {
      previewCtx.beginPath();
      previewCtx.moveTo(x * previewScale, 0);
      previewCtx.lineTo(x * previewScale, targetHeight * previewScale);
      previewCtx.stroke();
    }
    for (let y = 0; y <= targetHeight; y++) {
      previewCtx.beginPath();
      previewCtx.moveTo(0, y * previewScale);
      previewCtx.lineTo(targetWidth * previewScale, y * previewScale);
      previewCtx.stroke();
    }
  }
  
  return {
    width: targetWidth,
    height: targetHeight,
    pixels,
    previewDataUrl: previewCanvas.toDataURL('image/png'),
  };
}

/**
 * Get total pixel count (non-transparent)
 */
export function getPixelCount(pixelArt: PixelArtData): number {
  let count = 0;
  for (const row of pixelArt.pixels) {
    for (const pixel of row) {
      if (pixel !== 0) count++;
    }
  }
  return count;
}

/**
 * Get color index at position for contract (1-based, 0 = transparent)
 */
export function getColorIndexAt(pixelArt: PixelArtData, x: number, y: number): number {
  if (y < 0 || y >= pixelArt.height || x < 0 || x >= pixelArt.width) {
    return 0;
  }
  return pixelArt.pixels[y]![x]!;
}

/**
 * Calculate which shards the pixel art will span
 */
export function getAffectedShards(
  pixelArt: PixelArtData, 
  startPx: number, 
  startPy: number,
  shardDimension: number
): Array<{ x: number; y: number }> {
  const shardSet = new Set<string>();
  
  for (let y = 0; y < pixelArt.height; y++) {
    for (let x = 0; x < pixelArt.width; x++) {
      const colorIndex = pixelArt.pixels[y]![x]!;
      if (colorIndex !== 0) {
        const globalX = startPx + x;
        const globalY = startPy + y;
        const shardX = Math.floor(globalX / shardDimension);
        const shardY = Math.floor(globalY / shardDimension);
        shardSet.add(`${shardX},${shardY}`);
      }
    }
  }
  
  return Array.from(shardSet).map(key => {
    const [x, y] = key.split(',').map(Number);
    return { x: x!, y: y! };
  });
}
