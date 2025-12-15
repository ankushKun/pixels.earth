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
  initialFile?: File | null;
}

// Min and max size for the slider
const MIN_SIZE = 8;
const MAX_SIZE = 64;

export function ImageUploadDialog({ 
  open, 
  onOpenChange, 
  onConfirm,
  unlockedShards,
  initialFile
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
      if (initialFile) {
        handleFileSelect(initialFile);
      }
    }
  }, [open, initialFile]);

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
        e.stopPropagation();
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
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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

        <div className="space-y-4">
          {/* Combined Drop Zone & Preview */}
          <div
            className={`
              relative group flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-all overflow-hidden min-h-[200px]
              ${isProcessing 
                ? 'bg-muted border-muted-foreground/25' 
                : pixelArt
                  ? 'border-transparent bg-muted/30 p-0'
                  : 'bg-muted/30 border-muted-foreground/25 hover:bg-muted/50 hover:border-primary/50 cursor-pointer'}
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
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium text-muted-foreground">Processing image...</p>
              </div>
            ) : pixelArt ? (
              <div className="relative w-full h-full flex items-center justify-center bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMCAwSDRWNEgwem00IDhINFY0aDR6IiBmaWxsPSIjZjNmNGY2Ii8+PC9zdmc+')]">
                <img 
                  src={pixelArt.previewDataUrl} 
                  alt="Preview"
                  className="max-h-[250px] w-auto object-contain image-rendering-pixelated shadow-sm"
                  style={{ imageRendering: 'pixelated' }}
                />
                
                {/* Hover Overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white">
                  <ImageIcon className="h-8 w-8 mb-2" />
                  <span className="font-medium text-sm">Click to change image</span>
                  <span className="text-xs text-white/70 mt-1">or drag & drop</span>
                </div>

                {/* File Name Badge */}
                <div className="absolute bottom-2 left-2 right-2 flex justify-center pointer-events-none group-hover:opacity-0 transition-opacity">
                   <div className="bg-black/50 backdrop-blur-sm p-0 px-1 rounded text-xs text-white truncate max-w-[90%]">
                     {selectedFile?.name}
                   </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="rounded-full bg-primary/10 p-4">
                  <Upload className="h-8 w-8 text-primary" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold">Click to upload</p>
                  <p className="text-sm text-muted-foreground">or drag and drop</p>
                </div>
                <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                   PNG, JPG, GIF up to 10MB
                </div>
              </div>
            )}
          </div>

          {/* Settings & Stats */}
          <div className="space-y-4">
            <div className="flex gap-4">
               {/* Size Slider (Larger) */}
               <div className="flex-1 space-y-2">
                 <div className="flex items-center justify-between">
                   <Label>Target Size</Label>
                   <span className="text-sm font-mono text-muted-foreground">{maxSize}px</span>
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

               {/* Dithering Toggle (Compact) */}
               <div className="space-y-2">
                  <Label>Dithering</Label>
                  <Button
                    variant={useDithering ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setUseDithering(!useDithering)}
                    disabled={isProcessing}
                    className="w-full text-xs"
                  >
                    {useDithering ? 'Enabled' : 'Disabled'}
                  </Button>
               </div>
            </div>
            
            {/* Stats Row */}
            {pixelArt && (
              <div className="rounded-md bg-muted/40 p-3 grid grid-cols-2 gap-4 text-sm animate-in fade-in slide-in-from-top-2">
                 <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Pixels</span>
                    <span className="font-medium">{getPixelCount(pixelArt)}</span>
                 </div>
                 <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Est. Time</span>
                    <span className="font-medium text-primary">{estimatedTimeStr}</span>
                 </div>
                 <div className="col-span-2 flex flex-col gap-1 border-t pt-2">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Palette</span>
                    <div className="flex flex-wrap gap-1">
                      {getUsedColors(pixelArt).map((colorIndex) => (
                        <div
                          key={colorIndex}
                          className="h-3 w-3 rounded-[1px] shadow-sm ring-1 ring-black/5"
                          style={{ backgroundColor: PRESET_COLORS[colorIndex - 1] }}
                          title={PRESET_COLORS[colorIndex - 1]}
                        />
                      ))}
                    </div>
                 </div>
              </div>
            )}
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
