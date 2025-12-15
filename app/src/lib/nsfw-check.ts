/**
 * NSFW Content Detection using nsfwjs
 * Client-side content moderation to prevent inappropriate images
 */

import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

// Enable production mode for better performance
tf.enableProdMode();

// Cached model instance
let nsfwModel: nsfwjs.NSFWJS | null = null;
let modelLoading: Promise<nsfwjs.NSFWJS> | null = null;

/**
 * Load the NSFW detection model (cached)
 */
async function loadModel(): Promise<nsfwjs.NSFWJS> {
  if (nsfwModel) {
    return nsfwModel;
  }
  
  if (modelLoading) {
    return modelLoading;
  }
  
  console.log('[NSFW] Loading model...');
  modelLoading = nsfwjs.load('MobileNetV2');
  
  try {
    nsfwModel = await modelLoading;
    console.log('[NSFW] Model loaded successfully');
    return nsfwModel;
  } catch (error) {
    console.error('[NSFW] Failed to load model:', error);
    modelLoading = null;
    throw error;
  }
}

/**
 * NSFW classification result
 */
export interface NSFWResult {
  isNSFW: boolean;
  reason?: string;
  predictions: Array<{
    className: string;
    probability: number;
  }>;
}

/**
 * Check if an image is NSFW
 * 
 * @param imageElement - An HTMLImageElement to check
 * @returns NSFWResult indicating if the image is inappropriate
 */
export async function checkNSFW(imageElement: HTMLImageElement): Promise<NSFWResult> {
  try {
    const model = await loadModel();
    const predictions = await model.classify(imageElement);
    
    // Log predictions for debugging
    console.log('[NSFW] Predictions:', predictions);
    
    // Find probabilities for each category
    const findProb = (className: string) => 
      predictions.find(p => p.className === className)?.probability ?? 0;
    
    const pornProb = findProb('Porn');
    const hentaiProb = findProb('Hentai');
    const sexyProb = findProb('Sexy');
    
    // Thresholds for blocking content
    // These can be adjusted based on desired strictness
    const PORN_THRESHOLD = 0.5;    // 50% confidence for porn
    const HENTAI_THRESHOLD = 0.5;  // 50% confidence for hentai
    const SEXY_THRESHOLD = 0.7;    // 70% confidence for sexy (less strict)
    
    // Check if image is NSFW
    if (pornProb >= PORN_THRESHOLD) {
      return {
        isNSFW: true,
        reason: 'Image contains inappropriate content',
        predictions,
      };
    }
    
    if (hentaiProb >= HENTAI_THRESHOLD) {
      return {
        isNSFW: true,
        reason: 'Image contains inappropriate drawings',
        predictions,
      };
    }
    
    if (sexyProb >= SEXY_THRESHOLD) {
      return {
        isNSFW: true,
        reason: 'Image is too suggestive',
        predictions,
      };
    }
    
    // Image is safe
    return {
      isNSFW: false,
      predictions,
    };
  } catch (error) {
    console.error('[NSFW] Classification error:', error);
    // On error, allow the image (fail open) to not block users
    // In a stricter setup, you might want to fail closed instead
    return {
      isNSFW: false,
      reason: 'Unable to verify content',
      predictions: [],
    };
  }
}

/**
 * Check if a File is NSFW by loading it as an image
 * 
 * @param file - The image file to check
 * @returns NSFWResult indicating if the image is inappropriate
 */
export async function checkFileNSFW(file: File): Promise<NSFWResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = async () => {
      const result = await checkNSFW(img);
      URL.revokeObjectURL(img.src);
      resolve(result);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      // On error loading image, allow it
      resolve({
        isNSFW: false,
        reason: 'Unable to load image for verification',
        predictions: [],
      });
    };
    
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Preload the NSFW model (call this early to reduce latency later)
 */
export function preloadNSFWModel(): void {
  loadModel().catch(console.error);
}
