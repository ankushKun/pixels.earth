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
import { SHARD_DIMENSION, PRESET_COLORS } from '../constants';
import { Upload, ImageIcon, X, Wand2, AlertTriangle, Check, Loader2, Clipboard } from 'lucide-react';

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
  const [pixelArt, setPixelArt] = useState<PixelArtData | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [maxSize, setMaxSize] = useState(32);
  const [useDithering, setUseDithering] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setPixelArt(null);
      setSelectedFile(null);
      setError(null);
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
    setIsProcessing(true);

    try {
      const result = await convertImageToPixelArt(file, maxSize, useDithering);
      setPixelArt(result);
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
  
  // Calculate estimated time (50 pixels per 30 seconds = ~1.67 pixels per second)
  // But we can do burst of 50 pixels instantly, then wait 30s
  const estimatedBursts = Math.ceil(pixelCount / 50);
  const estimatedSeconds = estimatedBursts > 1 ? (estimatedBursts - 1) * 30 : 0;
  const estimatedTimeStr = estimatedSeconds > 60 
    ? `~${Math.ceil(estimatedSeconds / 60)} min` 
    : estimatedSeconds > 0 
      ? `~${estimatedSeconds}s` 
      : 'Instant';

  // Handle confirm
  const handleConfirm = () => {
    if (pixelArt) {
      onConfirm(pixelArt);
      handleOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-purple-500" />
            Import Image as Pixel Art
          </DialogTitle>
          <DialogDescription>
            Upload an image to convert it to pixel art using the available color palette.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Drop Zone */}
          <div
            className={`
              border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
              ${isProcessing ? 'border-gray-300 bg-gray-50' : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50/50'}
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
              <div className="flex flex-col items-center gap-2 text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin" />
                <span>Processing image...</span>
              </div>
            ) : selectedFile ? (
              <div className="flex flex-col items-center gap-2">
                <ImageIcon className="w-8 h-8 text-purple-500" />
                <span className="text-sm font-medium">{selectedFile.name}</span>
                <span className="text-xs text-gray-500">Click to change</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-500">
                <div className="flex items-center gap-3">
                  <Upload className="w-7 h-7" />
                  <Clipboard className="w-6 h-6" />
                </div>
                <span>Drop, paste, or click to upload an image</span>
                <span className="text-xs">PNG, JPG, GIF • Paste with ⌘V / Ctrl+V</span>
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="flex flex-col gap-4">
            {/* Size Slider */}
            <div className="w-full">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-gray-600">Resolution</Label>
                <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                  {maxSize}×{maxSize} max
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-6">{MIN_SIZE}</span>
                <Slider
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  step={4}
                  value={[maxSize]}
                  onValueChange={(values) => setMaxSize(values[0] ?? MIN_SIZE)}
                  disabled={isProcessing || !selectedFile}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-6">{MAX_SIZE}</span>
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-6">
                <span>Fewer pixels</span>
                <span>More detail</span>
              </div>
            </div>

            {/* Dithering Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUseDithering(!useDithering)}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors
                  ${useDithering 
                    ? 'bg-purple-500 text-white' 
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}
                `}
                disabled={isProcessing}
              >
                <Wand2 className="w-3 h-3" />
                Dithering
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Preview */}
          {pixelArt && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Preview</Label>
                <span className="text-xs text-gray-500">
                  {pixelArt.width}×{pixelArt.height} pixels
                </span>
              </div>
              
              <div className="flex justify-center p-4 bg-gray-100 rounded-lg">
                <img 
                  src={pixelArt.previewDataUrl} 
                  alt="Pixel art preview"
                  className="max-w-full max-h-[200px] image-rendering-pixelated"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-gray-50 p-2 rounded">
                  <span className="text-gray-500">Pixels to place:</span>
                  <span className="ml-1 font-medium">{pixelCount}</span>
                </div>
                <div className="bg-gray-50 p-2 rounded">
                  <span className="text-gray-500">Est. time:</span>
                  <span className="ml-1 font-medium">{estimatedTimeStr}</span>
                </div>
              </div>

              {/* Color Palette Used */}
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">Colors Used</Label>
                <div className="flex flex-wrap gap-1">
                  {getUsedColors(pixelArt).map((colorIndex) => (
                    <div
                      key={colorIndex}
                      className="w-5 h-5 rounded border border-gray-300"
                      style={{ backgroundColor: PRESET_COLORS[colorIndex - 1] }}
                      title={PRESET_COLORS[colorIndex - 1]}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!pixelArt || isProcessing}
              className="bg-purple-500 hover:bg-purple-600"
            >
              <Check className="w-4 h-4 mr-1" />
              Use Pixel Art
            </Button>
          </div>
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
