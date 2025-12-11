import { useCallback, useEffect, useRef } from 'react';
// @ts-ignore
import popSoundUrl from '../assets/pop.mp3';
// @ts-ignore
import unlockSoundUrl from '../assets/shard-created.mp3';
// @ts-ignore
import failSoundUrl from '../assets/fail.mp3';
// @ts-ignore
import bgMusicUrl from '../assets/bg-loop.mp3';

export function useGameSounds() {
    const bgMusicRef = useRef<HTMLAudioElement | null>(null);
    
    // Pop sound pool
    const audioPoolRef = useRef<HTMLAudioElement[]>([]);
    const poolIndexRef = useRef(0);
    const poolSize = 8;

    // Initialize BG Music and Pop Pool
    useEffect(() => {
        // Bg Music
        if (!bgMusicRef.current) {
            const audio = new Audio(bgMusicUrl);
            audio.loop = true;
            audio.volume = 0.12; // Low volume
            bgMusicRef.current = audio;

            // Try to play immediately
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    // Auto-play was prevented
                    // Add a one-time click listener to start audio
                    const startAudio = () => {
                        audio.play().catch(console.error);
                        document.removeEventListener('click', startAudio);
                        document.removeEventListener('keydown', startAudio);
                    };
                    document.addEventListener('click', startAudio);
                    document.addEventListener('keydown', startAudio);
                });
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
    }, []);

    const playPop = useCallback(() => {
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
    }, []);

    const playUnlock = useCallback(() => {
        try {
            const audio = new Audio(unlockSoundUrl);
            audio.volume = 0.6;
            audio.play().catch(console.error);
        } catch (e) {
            console.error('Failed to play unlock sound', e);
        }
    }, []);

    const playFail = useCallback(() => {
        try {
            const audio = new Audio(failSoundUrl);
            audio.volume = 0.5;
            audio.play().catch(console.error);
        } catch (e) {
            console.error('Failed to play fail sound', e);
        }
    }, []);

    return { playPop, playUnlock, playFail };
}
