import { useCallback, useEffect, useRef, useState } from 'react';
import popSoundUrl from '../assets/pop.mp3';
import unlockSoundUrl from '../assets/shard-created.mp3';
import failSoundUrl from '../assets/fail.mp3';
import bgMusicUrl from '../assets/bg-loop.mp3';

const MUTE_STORAGE_KEY = 'pixelworld-muted';

export function useGameSounds() {
    const bgMusicRef = useRef<HTMLAudioElement | null>(null);
    const audioPoolRef = useRef<HTMLAudioElement[]>([]);
    const poolIndexRef = useRef(0);
    const poolSize = 8;
    
    // Initialize mute state from localStorage
    const [isMuted, setIsMuted] = useState(() => {
        try {
            return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    });

    const toggleMute = useCallback(() => {
        setIsMuted(prev => {
            const next = !prev;
            localStorage.setItem(MUTE_STORAGE_KEY, String(next));
            return next;
        });
    }, []);

    // Initialize BG Music and Pop Pool
    useEffect(() => {
        // Bg Music
        if (!bgMusicRef.current) {
            const audio = new Audio(bgMusicUrl);
            audio.loop = true;
            audio.volume = 0.12; // Low volume
            bgMusicRef.current = audio;

            // Handle initial playback
            const playAudio = () => {
                if (bgMusicRef.current && bgMusicRef.current.paused && !isMuted) {
                    bgMusicRef.current.play().catch(() => {});
                }
            };

            // Try to play immediately if not muted
            if (!isMuted) {
                const playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {
                        // Auto-play prevented, wait for interaction
                        const startAudio = () => {
                            playAudio();
                            document.removeEventListener('click', startAudio);
                            document.removeEventListener('keydown', startAudio);
                        };
                        document.addEventListener('click', startAudio);
                        document.addEventListener('keydown', startAudio);
                    });
                }
            } else {
                // If muted, we still want to "unlock" audio on first interaction so we can play later
                const unlockAudio = () => {
                    // Just needed for browser policy mostly, but actually since we don't play, 
                    // we might need to handle this when we unmute.
                    document.removeEventListener('click', unlockAudio);
                    document.removeEventListener('keydown', unlockAudio);
                };
                document.addEventListener('click', unlockAudio);
                document.addEventListener('keydown', unlockAudio);
            }
        }

        // Pop Pool
        if (audioPoolRef.current.length === 0) {
            for (let i = 0; i < poolSize; i++) {
                const audio = new Audio(popSoundUrl);
                audio.preload = 'auto';
                audioPoolRef.current.push(audio);
            }
        }

        return () => {
            if (bgMusicRef.current) {
                bgMusicRef.current.pause();
                bgMusicRef.current = null;
            }
        };
    }, []); // Only run once on mount

    // Effect to handle mute toggling
    useEffect(() => {
        const audio = bgMusicRef.current;
        if (!audio) return;

        if (isMuted) {
            audio.pause();
        } else {
            // Unmuted, try to play
            audio.play().catch(() => {
                // If failed (e.g. no interaction yet), wait for interaction
                const startAudio = () => {
                    audio.play().catch(() => {});
                    document.removeEventListener('click', startAudio);
                    document.removeEventListener('keydown', startAudio);
                };
                document.addEventListener('click', startAudio);
                document.addEventListener('keydown', startAudio);
            });
        }
    }, [isMuted]);

    const playPop = useCallback(() => {
        if (isMuted) return;
        
        try {
            if (audioPoolRef.current.length === 0) return;
            
            const audio = audioPoolRef.current[poolIndexRef.current];
            if (!audio) return;

            poolIndexRef.current = (poolIndexRef.current + 1) % poolSize;
            
            audio.currentTime = 0;
            audio.volume = 0.5 + Math.random() * 0.5;
            audio.playbackRate = 0.9 + Math.random() * 0.2; // Slight pitch variation
            audio.play().catch(() => {});
        } catch (e) {
            // Ignore
        }
    }, [isMuted]);

    const playUnlock = useCallback(() => {
        if (isMuted) return;

        try {
            const audio = new Audio(unlockSoundUrl);
            audio.volume = 0.6;
            audio.play().catch(console.error);
        } catch (e) {
            console.error('Failed to play unlock sound', e);
        }
    }, [isMuted]);

    const playFail = useCallback(() => {
        if (isMuted) return;

        try {
            const audio = new Audio(failSoundUrl);
            audio.volume = 0.5;
            audio.play().catch(console.error);
        } catch (e) {
            console.error('Failed to play fail sound', e);
        }
    }, [isMuted]);

    return { playPop, playUnlock, playFail, isMuted, toggleMute };
}
