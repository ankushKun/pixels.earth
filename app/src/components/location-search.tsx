/**
 * Location Search Component
 * Uses Nominatim API to search for locations and navigate to them on the map
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, MapPin, Loader2 } from 'lucide-react';
import { globalPxToLatLon } from '../lib/projection';
import { SHARD_DIMENSION } from '../constants';

interface SearchResult {
    display_name: string;
    lat: string;
    lon: string;
    type: string;
    class: string; // e.g., 'boundary', 'place', 'highway'
    importance: number;
    boundingbox: [string, string, string, string]; // [south, north, west, east]
}

interface LocationSearchProps {
    onLocationSelect: (lat: number, lon: number, name: string, zoomLevel: number) => void;
    isOpen: boolean;
    onClose: () => void;
}

export function LocationSearch({ onLocationSelect, isOpen, onClose }: LocationSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Focus input when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
        if (!isOpen) {
            setQuery('');
            setResults([]);
            setSelectedIndex(-1);
        }
    }, [isOpen]);

    // Debounced search
    const searchLocations = useCallback(async (searchQuery: string) => {
        if (searchQuery.length < 2) {
            setResults([]);
            return;
        }

        setIsLoading(true);
        const lowerQuery = searchQuery.toLowerCase();
        const isSecret = lowerQuery.includes('secret') || lowerQuery.includes('doot');
        
        // Prepare secret location result if needed
        let secretResult: SearchResult | null = null;
        if (isSecret) {
            // Secret Location: Shard 69, 420
            const shardX = 69;
            const shardY = 420;
            const centerPx = (shardX + 0.5) * SHARD_DIMENSION;
            const centerPy = (shardY + 0.5) * SHARD_DIMENSION;
            const { lat, lon } = globalPxToLatLon(centerPx, centerPy);
            
            secretResult = {
                display_name: 'The Secret Location',
                lat: lat.toString(),
                lon: lon.toString(),
                type: 'secret',
                class: 'place',
                importance: 1.0,
                boundingbox: [
                    (lat - 0.001).toString(),
                    (lat + 0.001).toString(),
                    (lon - 0.001).toString(),
                    (lon + 0.001).toString()
                ] // simple bounding box
            };
        }

        // Helper for retry
        const fetchWithRetry = async (retries = 3, delay = 1000): Promise<SearchResult[]> => {
            for (let i = 0; i < retries; i++) {
                try {
                    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=8&addressdetails=1`;
                    const response = await fetch(url, {
                        headers: { 'User-Agent': 'MagicPlace/1.0 (https://magicplace.app)' },
                    });
                    if (response.ok) return await response.json();
                } catch (e) {
                    if (i === retries - 1) throw e;
                    await new Promise(r => setTimeout(r, delay));
                }
            }
            return [];
        };

        try {
            // Show secret result immediately so user sees coords while API retries
            if (isSecret && secretResult) {
               setResults([secretResult]);
            }

            const data = await fetchWithRetry();
            
            const finalResults = isSecret && secretResult ? [secretResult, ...data] : data;
            setResults(finalResults);
            setSelectedIndex(-1);
            
        } catch (error) {
            console.error('Location search failed:', error);
            // If failed, but secret, at least show secret
            if (isSecret && secretResult) {
                setResults([secretResult]);
                setSelectedIndex(-1);
            } else {
                setResults([]);
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Handle input change with debounce
    const handleInputChange = (value: string) => {
        setQuery(value);
        
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        
        debounceRef.current = setTimeout(() => {
            searchLocations(value);
        }, 300);
    };

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, -1));
        } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < results.length) {
            e.preventDefault();
            const result = results[selectedIndex];
            if (result) handleSelectResult(result);
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    // Calculate zoom level based on bounding box
    const calculateZoomFromBoundingBox = (bb: [string, string, string, string], locClass: string, locType: string): number => {
        // Parse bounding box [south, north, west, east]
        const south = parseFloat(bb[0]);
        const north = parseFloat(bb[1]);
        const west = parseFloat(bb[2]);
        const east = parseFloat(bb[3]);
        
        // Calculate the span
        const latSpan = Math.abs(north - south);
        const lonSpan = Math.abs(east - west);
        const maxSpan = Math.max(latSpan, lonSpan);
        
        // Calculate zoom based on span (rough approximation)
        // Larger span = lower zoom
        let zoom: number;
        if (maxSpan > 40) {
            zoom = 3;  // Continent/large country
        } else if (maxSpan > 15) {
            zoom = 4;  // Country
        } else if (maxSpan > 5) {
            zoom = 6;  // State/region
        } else if (maxSpan > 1) {
            zoom = 8;  // County/large city
        } else if (maxSpan > 0.3) {
            zoom = 10; // City
        } else if (maxSpan > 0.1) {
            zoom = 12; // Town/district
        } else if (maxSpan > 0.01) {
            zoom = 14; // Neighborhood
        } else {
            zoom = 16; // Street/building
        }
        
        // Adjust based on class/type for better accuracy
        if (locClass === 'boundary' && locType === 'administrative') {
            // Countries, states, etc. - trust bounding box
        } else if (locClass === 'place') {
            // Places: city, town, village, etc.
            if (locType === 'city' && zoom < 10) zoom = 10;
            if (locType === 'town' && zoom < 12) zoom = 12;
            if (locType === 'village' && zoom < 13) zoom = 13;
        } else if (locClass === 'highway' || locClass === 'building') {
            // Streets and buildings - zoom in close
            if (zoom < 16) zoom = 16;
        }
        
        return zoom;
    };

    // Handle result selection
    const handleSelectResult = (result: SearchResult) => {
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);
        
        // Get a short name from display_name (first part before comma usually)
        const shortName = result.display_name.split(',')[0]?.trim() || 'Unknown';
        
        // Calculate appropriate zoom level
        const zoomLevel = calculateZoomFromBoundingBox(
            result.boundingbox,
            result.class,
            result.type
        );
        
        onLocationSelect(lat, lon, shortName, zoomLevel);
        onClose();
    };

    // Cleanup debounce on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, []);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                onClick={onClose}
            />
            
            {/* Search Panel */}
            <div className="relative w-full max-w-md mx-4 bg-white rounded-xl shadow-2xl overflow-hidden">
                {/* Search Input */}
                <div className="flex items-center gap-3 p-4 border-b border-slate-100">
                    <Search className="w-5 h-5 text-slate-400 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => handleInputChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search for a location..."
                        className="flex-1 outline-none text-lg text-slate-800 placeholder:text-slate-400"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    {isLoading && (
                        <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
                    )}
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                {/* Results List */}
                {results.length > 0 && (
                    <div className="max-h-80 overflow-y-auto">
                        {results.map((result, index) => (
                            <button
                                key={`${result.lat}-${result.lon}-${index}`}
                                onClick={() => handleSelectResult(result)}
                                onMouseEnter={() => setSelectedIndex(index)}
                                className={`w-full flex items-start gap-3 p-3 text-left transition-colors ${
                                    selectedIndex === index
                                        ? 'bg-blue-50'
                                        : 'hover:bg-slate-50'
                                }`}
                            >
                                <MapPin className={`w-5 h-5 mt-0.5 shrink-0 ${
                                    selectedIndex === index
                                        ? 'text-blue-500'
                                        : 'text-slate-400'
                                }`} />
                                <div className="min-w-0 flex-1">
                                    <div className={`font-medium truncate ${
                                        selectedIndex === index
                                            ? 'text-blue-700'
                                            : 'text-slate-700'
                                    }`}>
                                        {result.display_name.split(',')[0]}
                                    </div>
                                    <div className="text-sm text-slate-500 truncate">
                                        {result.type === 'secret' 
                                            ? <span className="text-emerald-600 font-mono">Shard: 69, 420 • coords: {Number(result.lat).toFixed(4)}, {Number(result.lon).toFixed(4)}</span> 
                                            : result.display_name.split(',').slice(1).join(',').trim()
                                        }
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {/* Empty State */}
                {query.length >= 2 && results.length === 0 && !isLoading && (
                    <div className="p-8 text-center text-slate-500">
                        <MapPin className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                        <p>No locations found</p>
                        <p className="text-sm text-slate-400 mt-1">Try a different search term</p>
                    </div>
                )}

                {/* Hint */}
                {query.length < 2 && results.length === 0 && (
                    <div className="p-6 text-center text-slate-500">
                        <p className="text-sm">Type at least 2 characters to search</p>
                    </div>
                )}
            </div>
        </div>
    );
}
