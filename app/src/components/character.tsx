import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import speech1 from "../assets/speech-1.png"
import speech2 from "../assets/speech-2.png"

type AnimationState = 'entering' | 'visible' | 'flipping' | 'exiting'

export default function Character(props: React.HTMLAttributes<HTMLDivElement> & { frame?: 0 | 1 }) {
    const [displayedContent, setDisplayedContent] = useState<React.ReactNode>(props.children)
    const [animationState, setAnimationState] = useState<AnimationState>(props.children ? 'entering' : 'visible')
    const [currentFrame, setCurrentFrame] = useState(props.frame ?? 0)
    const [flipKey, setFlipKey] = useState(0) // Used to re-trigger flip animation
    const prevChildrenRef = useRef<React.ReactNode>(props.children)
    const isFirstMount = useRef(true)

    useEffect(() => {
        // Skip initial mount
        if (isFirstMount.current) {
            isFirstMount.current = false
            if (props.children) {
                // Start with entering animation
                const timer = setTimeout(() => {
                    setAnimationState('visible')
                }, 300)
                return () => clearTimeout(timer)
            }
            return
        }

        const prevChildren = prevChildrenRef.current
        const newChildren = props.children
        prevChildrenRef.current = newChildren

        // Case 1: Had content, now null -> Slide out
        if (prevChildren && !newChildren) {
            setAnimationState('exiting')
            const timer = setTimeout(() => {
                setDisplayedContent(null)
                setAnimationState('visible')
            }, 300)
            return () => clearTimeout(timer)
        }

        // Case 2: Had no content, now has content -> Slide in
        if (!prevChildren && newChildren) {
            setDisplayedContent(newChildren)
            setAnimationState('entering')
            const timer = setTimeout(() => {
                setAnimationState('visible')
            }, 300)
            return () => clearTimeout(timer)
        }

        // Case 3: Content changed to different content -> Flip frame
        if (prevChildren && newChildren && prevChildren !== newChildren) {
            setAnimationState('flipping')
            setFlipKey(k => k + 1) // Trigger re-animation
            
            const timer = setTimeout(() => {
                setDisplayedContent(newChildren)
                setCurrentFrame(prev => prev === 0 ? 1 : 0)
                setAnimationState('visible')
            }, 150) // Match flip animation duration
            return () => clearTimeout(timer)
        }
    }, [props.children])

    // Don't render if no content and not in an animation state
    if (!displayedContent && animationState === 'visible') return null

    const getAnimationClass = () => {
        switch (animationState) {
            case 'entering':
                return 'animate-slide-in-left'
            case 'exiting':
                return 'animate-slide-out-left'
            case 'flipping':
                return ''
            default:
                return ''
        }
    }

    return (
        <div
            {...props}
            className={cn(
                // Base/Mobile: Fixed card at bottom
                "fixed bottom-4 left-4 right-4 z-[999] bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-slate-200/50 p-6 md:p-0",
                // Desktop: Restore original absolute positioning and sizing for image
                "md:bg-transparent md:backdrop-blur-none md:rounded-none md:shadow-none md:border-none md:absolute md:left-0 md:bottom-0 md:right-auto md:max-w-[1000px] md:min-w-[1000px] md:drop-shadow-xl md:drop-shadow-black/70",
                "whitespace-normal",
                getAnimationClass(),
                props.className
            )}
        >
            <img src={currentFrame === 1 ? speech2 : speech1} draggable={false} className="hidden md:block pointer-events-none select-none" />
            <div
                key={flipKey}
                className={cn(
                    // Base/Mobile: Flow content
                    "w-full relative",
                    // Desktop: Absolute positioning inside bubble
                    "md:absolute md:top-[51px] md:right-[50px] md:max-w-[485px] md:min-w-[485px] md:h-[226px]",
                    "break-words text-ellipsis text-center flex flex-col items-center justify-center",
                    animationState === 'flipping' && 'animate-frame-flip'
                )}
            >
                {displayedContent}
            </div>
        </div>
    )
}