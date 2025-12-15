/**
 * Image Upload Dialog
 * Allows users to upload images and convert them to pixel art for stamping on the canvas
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Slider } from './ui/slider';
import { 
  convertImageToPixelArt, 
  getPixelCount, 
  getAffectedShards,
  type PixelArtData 
} from '../lib/image-to-pixel-art';
import { checkFileNSFW, preloadNSFWModel } from '../lib/nsfw-check';
import { SHARD_DIMENSION, PRESET_COLORS } from '../constants';
import { Upload, ImageIcon, AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';

interface ImageUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (pixelArt: PixelArtData) => void;
  unlockedShards: Set<string>;
}

// Min and max size for the slider
const MIN_SIZE = 8;
const MAX_SIZE = 64;

export function ImageUploadDialog({ 
  open, 
  onOpenChange, 
  onConfirm,
  unlockedShards 
}: ImageUploadDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nsfwBlocked, setNsfwBlocked] = useState(false);
  const [pixelArt, setPixelArt] = useState<PixelArtData | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [maxSize, setMaxSize] = useState(32);
  const [useDithering, setUseDithering] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preload NSFW model when dialog opens
  useEffect(() => {
    if (open) {
      preloadNSFWModel();
    }
  }, [open]);

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setPixelArt(null);
      setSelectedFile(null);
      setError(null);
      setNsfwBlocked(false);
    }
    onOpenChange(newOpen);
  };

  // Handle file selection
  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      setError('Image too large. Please use an image under 10MB.');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setNsfwBlocked(false);
    setIsProcessing(true);
    
    try {
      // Run NSFW check and image processing in parallel
      const [nsfwResult, pixelArtResult] = await Promise.all([
        checkFileNSFW(file).catch(err => {
          console.error('NSFW check error:', err);
          return { isNSFW: false, reason: undefined, predictions: [] }; // Fail open
        }),
        convertImageToPixelArt(file, maxSize, useDithering),
      ]);
      
      // Check NSFW result first
      if (nsfwResult.isNSFW) {
        setError(nsfwResult.reason || 'This image contains inappropriate content');
        setNsfwBlocked(true);
        setPixelArt(null);
        return;
      }
      
      // Image is safe, show the result
      setPixelArt(pixelArtResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image');
      setPixelArt(null);
    } finally {
      setIsProcessing(false);
    }
  }, [maxSize, useDithering]);

  // Handle clipboard paste
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!open) return; // Only handle paste when dialog is open
    
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          // Create a new file with a proper name for pasted images
          const pastedFile = new File([file], `pasted-image-${Date.now()}.png`, { type: file.type });
          handleFileSelect(pastedFile);
        }
        break;
      }
    }
  }, [open, handleFileSelect]);

  // Listen for paste events when dialog is open
  useEffect(() => {
    if (open) {
      document.addEventListener('paste', handlePaste);
      return () => document.removeEventListener('paste', handlePaste);
    }
  }, [open, handlePaste]);

  // Re-process when settings change
  const reprocessImage = useCallback(async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setError(null);

    try {
      const result = await convertImageToPixelArt(selectedFile, maxSize, useDithering);
      setPixelArt(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image');
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, maxSize, useDithering]);

  // Auto-reprocess when maxSize changes (for slider)
  useEffect(() => {
    if (selectedFile && !isProcessing) {
      reprocessImage();
    }
  }, [maxSize]);

  // Auto-reprocess when dithering changes
  useEffect(() => {
    if (selectedFile && !isProcessing) {
      reprocessImage();
    }
  }, [useDithering]);

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Calculate stats
  const pixelCount = pixelArt ? getPixelCount(pixelArt) : 0;
  
  // Calculate estimated time with bulk placement (50 pixels per transaction)
  // On YOUR shard: ~700ms per batch (transaction + confirmation + 100ms delay)
  // On OTHERS' shards: 30s cooldown between batches of 50
  // Assume best case (own shard) for the estimate
  const numBatches = Math.ceil(pixelCount / 50);
  const estimatedSeconds = numBatches * 0.7; // ~700ms per batch
  const estimatedTimeStr = estimatedSeconds >= 60 
    ? `~${Math.ceil(estimatedSeconds / 60)} min` 
    : estimatedSeconds >= 1 
      ? `~${Math.ceil(estimatedSeconds)}s` 
      : pixelCount > 0 ? '<1s' : 'Instant';

  // Handle confirm
  const handleConfirm = () => {
    if (pixelArt) {
      onConfirm(pixelArt);
      handleOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Import Pixel Art</DialogTitle>
          <DialogDescription>
            Convert an image to pixel art for the map.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* File Drop Zone */}
          <div
            className={`
              flex flex-col items-center justify-center rounded-md border border-dashed p-8 text-center animate-in fade-in zoom-in-95 duration-200
              ${isProcessing 
                ? 'bg-muted opacity-50' 
                : 'bg-muted/50 hover:bg-muted cursor-pointer'}
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => !isProcessing && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
              disabled={isProcessing}
            />
            
            {isProcessing ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Processing...</p>
              </div>
            ) : selectedFile ? (
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-full bg-primary/10 p-2">
                  <ImageIcon className="h-6 w-6 text-primary" />
                </div>
                <div className="text-sm font-medium">{selectedFile.name}</div>
                <div className="text-xs text-muted-foreground">Click to replace</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-full bg-muted p-2">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="text-sm font-medium">Click to upload</div>
                <div className="text-xs text-muted-foreground">or drag and drop</div>
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Size</Label>
                <span className="text-sm text-muted-foreground">{maxSize}px</span>
              </div>
              <Slider
                min={MIN_SIZE}
                max={MAX_SIZE}
                step={4}
                value={[maxSize]}
                onValueChange={(values) => setMaxSize(values[0] ?? MIN_SIZE)}
                disabled={isProcessing || !selectedFile}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Dithering</Label>
              <Button
                variant={useDithering ? "default" : "outline"}
                size="sm"
                onClick={() => setUseDithering(!useDithering)}
                disabled={isProcessing}
                className="h-7 text-xs"
              >
                {useDithering ? 'On' : 'Off'}
              </Button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className={`flex items-start gap-2 rounded-md p-3 text-sm ${
              nsfwBlocked 
                ? 'bg-destructive/15 text-destructive' 
                : 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-500'
            }`}>
              {nsfwBlocked ? (
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <div className="grid gap-1">
                {nsfwBlocked && <span className="font-medium">Content Blocked</span>}
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Preview */}
          {pixelArt && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Preview</Label>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>{getPixelCount(pixelArt)} pixels</span>
                  <span>•</span>
                  <span>{estimatedTimeStr}</span>
                </div>
              </div>
              
              <div className="flex items-center justify-center rounded-md border bg-muted/50 p-4">
                <img 
                  src={pixelArt.previewDataUrl} 
                  alt="Preview"
                  className="max-h-[200px] object-contain image-rendering-pixelated"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>

               {/* Colors */}
               <div className="flex flex-wrap gap-1">
                  {getUsedColors(pixelArt).map((colorIndex) => (
                    <div
                      key={colorIndex}
                      className="h-4 w-4 rounded-[2px] border ring-offset-background"
                      style={{ backgroundColor: PRESET_COLORS[colorIndex - 1] }}
                      title={PRESET_COLORS[colorIndex - 1]}
                    />
                  ))}
                </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!pixelArt || isProcessing}
          >
            Import
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Helper to get unique colors used in the pixel art
function getUsedColors(pixelArt: PixelArtData): number[] {
  const colors = new Set<number>();
  for (const row of pixelArt.pixels) {
    for (const pixel of row) {
      if (pixel !== 0) colors.add(pixel);
    }
  }
  return Array.from(colors).sort((a, b) => a - b);
}

export default ImageUploadDialog;
