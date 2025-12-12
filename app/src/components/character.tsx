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
                return 'animate-frame-flip'
            default:
                return ''
        }
    }

    return (
        <div
            {...props}
            className={cn(
                "absolute left-0 bottom-0 z-999 drop-shadow-xl drop-shadow-black/70 max-w-[1000px] min-w-[1000px] whitespace-normal",
                getAnimationClass(),
                props.className
            )}
        >
            <img src={currentFrame === 1 ? speech2 : speech1} />
            <div
                key={flipKey}
                className={cn(
                    "absolute top-[51px] right-[50px] max-w-[485px] min-w-[485px] w-full h-[226px] break-all text-ellipsis text-center flex flex-col items-center justify-center",
                    animationState === 'flipping' && 'animate-frame-flip'
                )}
            >
                {displayedContent}
            </div>
        </div>
    )
}