import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTourActions, TourItems } from '../hooks/use-tour';

interface CooldownTimerProps {
    pixelsPlaced: number;
    maxPixels: number;
    lastPlaceTimestamp: number; // Unix timestamp in seconds
    cooldownPeriod: number; // seconds
}

export function CooldownTimer({ pixelsPlaced, maxPixels, lastPlaceTimestamp, cooldownPeriod }: CooldownTimerProps) {
    const [timeLeft, setTimeLeft] = useState(0);
    const [effectivePlaced, setEffectivePlaced] = useState(pixelsPlaced);
    const actions = useTourActions();

    useEffect(() => {
        const update = () => {
            const now = Math.floor(Date.now() / 1000);
            const elapsed = now - lastPlaceTimestamp;

            if (pixelsPlaced >= maxPixels) {
                // Saturated: Check if cooldown passed
                if (elapsed >= cooldownPeriod) {
                    if (timeLeft > 0) {
                        toast.success("Cooldown over! You can start placing pixels again.");
                        // Show first-time cooldown complete explanation
                        actions.start(TourItems.CooldownCompleted);
                    }
                    setTimeLeft(0);
                    setEffectivePlaced(0);
                } else {
                    setTimeLeft(cooldownPeriod - elapsed);
                    setEffectivePlaced(pixelsPlaced);
                }
            } else {
                // Not saturated: Show accumulated count
                setTimeLeft(0);
                setEffectivePlaced(pixelsPlaced);
            }
        };

        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [pixelsPlaced, lastPlaceTimestamp, cooldownPeriod, maxPixels, timeLeft]);

    const isCooldown = effectivePlaced >= maxPixels;
    const progress = isCooldown
        ? (timeLeft / cooldownPeriod) * 100
        : (effectivePlaced / maxPixels) * 100;

    let color = '#10b981'; // Emerald-500
    if (!isCooldown) {
        if ((effectivePlaced / maxPixels) > 0.6) color = '#eab308'; // Yellow-500
        if ((effectivePlaced / maxPixels) > 0.8) color = '#f97316'; // Orange-500
    } else {
        color = '#ef4444'; // Red-500
    }

    return (
        <div className="relative w-10 h-10 flex items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm transition-transform hover:scale-105 select-none">
            {/* Track Background */}
            <div className="absolute inset-0 rounded-full bg-slate-100" />
            
            {/* Conic Gradient Pie */}
            <div 
                className="absolute inset-0 rounded-full transition-all duration-500 ease-in-out"
                style={{ 
                    background: `conic-gradient(${color} ${progress}%, transparent 0)` 
                }}
            />

            {/* Inner Mask (Donut center) */}
            <div className="absolute inset-[3px] rounded-full bg-white flex items-center justify-center">
                <span className={`text-xs font-bold tracking-tight ${isCooldown ? 'text-red-500' : 'text-slate-600'}`}>
                    {isCooldown ? timeLeft : effectivePlaced}
                </span>
            </div>
        </div>
    );
}

