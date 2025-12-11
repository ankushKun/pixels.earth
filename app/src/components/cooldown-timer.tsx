import { useEffect, useState } from 'react';

interface CooldownTimerProps {
    pixelsPlaced: number;
    maxPixels: number;
    lastPlaceTimestamp: number; // Unix timestamp in seconds
    cooldownPeriod: number; // seconds (30)
}

export function CooldownTimer({ pixelsPlaced, maxPixels, lastPlaceTimestamp, cooldownPeriod }: CooldownTimerProps) {
    const [timeLeft, setTimeLeft] = useState(0);
    const [effectivePlaced, setEffectivePlaced] = useState(pixelsPlaced);

    useEffect(() => {
        const update = () => {
            const now = Math.floor(Date.now() / 1000);
            const elapsed = now - lastPlaceTimestamp;

            if (pixelsPlaced >= maxPixels) {
                // Saturated: Check if cooldown passed
                if (elapsed >= cooldownPeriod) {
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
    }, [pixelsPlaced, lastPlaceTimestamp, cooldownPeriod, maxPixels]);

    // Calculate progress
    // If effectivePlaced is 0, progress is 0.
    // If effectivePlaced is maxPixels, progress is 100.
    const percentage = Math.min(100, Math.max(0, (effectivePlaced / maxPixels) * 100));
    
    // Circle config
    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;
    
    // Determine color based on usage
    let colorClass = "text-emerald-500";
    if (percentage > 50) colorClass = "text-yellow-500";
    if (percentage > 80) colorClass = "text-orange-500";
    if (percentage >= 100) colorClass = "text-red-500";

    if (effectivePlaced === 0) {
        // Hide if no pixels placed? Or show clean state?
        // User asked to act as counter for pixels placed.
        // Showing 0/100 is good data.
    }

    return (
        <div className="flex items-center gap-3 bg-white/95 backdrop-blur shadow-lg rounded-xl px-3 py-2 border border-slate-200/60 transition-all hover:scale-105 select-none">
            {/* Pie Chart */}
            <div className="relative w-10 h-10 flex items-center justify-center">
                <svg className="transform -rotate-90 w-10 h-10">
                    {/* Background Ring */}
                    <circle
                        cx="20"
                        cy="20"
                        r={radius}
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="transparent"
                        className="text-slate-100"
                    />
                    {/* Progress Ring */}
                    <circle
                        cx="20"
                        cy="20"
                        r={radius}
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="transparent"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        className={`${colorClass} transition-all duration-500 ease-out`}
                    />
                </svg>
                {/* Center Icon/Text */}
                 <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-600">
                    {effectivePlaced}
                </div>
            </div>

            {/* Information */}
            <div className="flex flex-col">
                <div className="text-[10px] uppercase font-bold text-slate-400 leading-tight">
                    Burst Limit
                </div>
                <div className="flex items-baseline gap-1">
                    <span className={`text-sm font-bold ${percentage >= 100 ? 'text-red-500' : 'text-slate-700'}`}>
                        {effectivePlaced}
                    </span>
                    <span className="text-xs text-slate-400">/ {maxPixels}</span>
                </div>
                {effectivePlaced >= maxPixels && timeLeft > 0 && (
                     <div className="text-[10px] text-red-500 font-bold leading-tight mt-0.5 animate-pulse">
                        Maxed Out! {timeLeft}s
                    </div>
                )}
            </div>
        </div>
    );
}
