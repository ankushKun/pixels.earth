import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSessionKey } from "@/hooks/use-session-key"
import { useTourActions, useTourItems, TourItems, TourStateValues } from "../hooks/use-tour"
import { getNickname, setNickname } from "@/hooks/use-gun-presence"
import Character from "./character"
import { Button } from "./ui/button"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { useMagicplaceProgram } from "@/hooks/use-magicplace-program"
import { useSessionBalance } from "./session-balance-provider"
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js"
import { ScanEye } from "lucide-react"

// Minimum SOL required in session key
const MIN_SESSION_BALANCE = 0.01

// ============================================================================
// Icons
// ============================================================================

const CheckIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>
)

const SpinnerIcon = ({ size = 16 }: { size?: number }) => (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/>
        <path d="M12 2C6.48 2 2 6.48 2 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
    </svg>
)

// ============================================================================
// Step Indicator Component
// ============================================================================

interface StepIndicatorProps {
    label: string
    done: boolean
    active: boolean
}

function StepIndicator({ label, done, active }: StepIndicatorProps) {
    return (
        <div className={`flex items-center gap-3 transition-colors duration-300 ${active ? "opacity-100" : "opacity-60"}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 border ${
                done 
                    ? "bg-emerald-500 border-emerald-500 text-white" 
                    : active 
                        ? "bg-white border-blue-500 text-blue-500" 
                        : "bg-slate-100 border-slate-200 text-slate-300"
            }`}>
                {done ? (
                    <CheckIcon size={12} />
                ) : active ? (
                    <SpinnerIcon size={12} />
                ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-current" />
                )}
            </div>
            <span className={`text-sm font-medium transition-colors duration-300 ${
                done ? "text-emerald-700" : active ? "text-blue-700" : "text-slate-400"
            }`}>
                {label}
            </span>
        </div>
    )
}

// ============================================================================
// Tour Component
// ============================================================================

// ============================================================================
// Tour Dialogue Layout
// ============================================================================

interface TourDialogueProps {
    title: React.ReactNode
    description?: React.ReactNode
    children?: React.ReactNode
    footer?: React.ReactNode
    className?: string
}

function TourDialogue({ title, description, children, footer, className }: TourDialogueProps) {
    return (
        <div className={`flex flex-col items-center justify-center w-full h-full p-0 gap-1 wrap-break-words ${className || ''}`}>
            <div className="text-center space-y-0.5 shrink-0">
                <h2 className="text-lg font-black tracking-tight text-slate-900 leading-tight">{title}</h2>
                {description && (
                    <div className="text-xs font-medium text-slate-500 leading-snug mx-auto">
                        {description}
                    </div>
                )}
            </div>
            {children && (
                <div className="flex flex-col items-center justify-center gap-1 w-full shrink-0">
                    {children}
                </div>
            )}
            {footer && (
                <div className="mt-0 shrink-0">
                    {footer}
                </div>
            )}
        </div>
    )
}

// ... lines 122-340 ...



// ============================================================================
// Tour Component
// ============================================================================

export default function Tour() {
    const items = useTourItems()
    const actions = useTourActions()
    const { sessionKey, isActive: sessionActive, createSessionKey, isLoading: sessionLoading, isRestoring } = useSessionKey()
    const { connection } = useConnection()
    const wallet = useWallet()
    const { initializeUser, delegateUser, checkUserDelegation } = useMagicplaceProgram()
    const { balance: sessionBalance, topupRequest, clearTopupRequest, topup, refreshBalance } = useSessionBalance()

    // UI state
    const [isProcessing, setIsProcessing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isTopupLoading, setIsTopupLoading] = useState(false)
    const [hasExplored, setHasExplored] = useState(false) // Tracks if user clicked "Just explore"
    
    // Setup step tracking
    const [setupStep, setSetupStep] = useState<"deriving" | "authorizing" | "funding" | "initializing" | "delegating" | null>(null)
    const [stepStatus, setStepStatus] = useState({
        derive: false,
        authorize: false,
        fund: false,
        init: false,
        delegate: false,
    })
    const nicknameInputRef = useRef<HTMLInputElement>(null)

    // Show LowSessionBalance dialog when there's a topup request
    useEffect(() => {
        if (topupRequest && items[TourItems.LowSessionBalance] !== TourStateValues.InProgress) {
            actions.forceStart(TourItems.LowSessionBalance)
        }
    }, [topupRequest, items, actions])

    // Handle topup from Character dialog
    const handleTopup = useCallback(async () => {
        if (!topupRequest) return
        
        setIsTopupLoading(true)
        setError(null)
        try {
            const suggestedAmount = Math.max(0.01, Math.ceil((topupRequest.amountNeeded - (sessionBalance || 0) + 0.005) * 100) / 100)
            await topup(suggestedAmount)
            clearTopupRequest()
            actions.complete(TourItems.LowSessionBalance)
            // Call success callback if present
            topupRequest.onSuccess?.()
        } catch (e) {
            setError(e instanceof Error ? e.message : "Top-up failed")
        } finally {
            setIsTopupLoading(false)
        }
    }, [topupRequest, sessionBalance, topup, clearTopupRequest, actions])

    // Cancel topup
    const handleCancelTopup = useCallback(() => {
        clearTopupRequest()
        actions.complete(TourItems.LowSessionBalance)
    }, [clearTopupRequest, actions])

    // =========================================================================
    // Unified State Management - handles all automatic transitions
    // =========================================================================
    useEffect(() => {
        const currentIntro = items[TourItems.OnboardingIntro]
        const currentSessionKey = items[TourItems.NeedsSessionKey]
        const currentComplete = items[TourItems.OnboardingComplete]

        // Case 1: No wallet connected - show intro only if user hasn't explored yet
        if (!wallet.connected && !wallet.connecting) {
            if (currentIntro !== TourStateValues.InProgress && !hasExplored) {
                // Reset any processing states
                setIsProcessing(false)
                setSetupStep(null)
                setError(null)
                actions.forceStart(TourItems.OnboardingIntro)
            }
            return // Don't process other cases
        }

        // Case 2: Wallet connected
        if (wallet.connected) {
            // If we're in intro and wallet just connected, move to session key step
            if (currentIntro === TourStateValues.InProgress) {
                actions.complete(TourItems.OnboardingIntro)
                actions.forceStart(TourItems.NeedsSessionKey)
                actions.forceStart(TourItems.NeedsSessionKey)
                return
            }
            
            // Check Nickname
            const hasNickname = !!getNickname()
            const currentNickname = items[TourItems.NeedsNickname]
            
            if (currentNickname !== TourStateValues.Completed) {
                if (hasNickname) {
                    actions.complete(TourItems.NeedsNickname)
                } else {
                    if (currentNickname !== TourStateValues.InProgress) {
                        actions.forceStart(TourItems.NeedsNickname)
                    }
                    return // Stop here until nickname is set
                }
            }

            // If wallet connected but no active session and onboarding not complete,
            // auto-start session key flow (e.g., user connected via wallet button)
            if (!sessionActive && currentSessionKey !== TourStateValues.InProgress && 
                currentComplete !== TourStateValues.Completed && !isProcessing && !isRestoring) {
                actions.forceStart(TourItems.NeedsSessionKey)
                return
            }

            // If we're in session key step and session is already active, skip to complete
            if (currentSessionKey === TourStateValues.InProgress && sessionActive && !isProcessing) {
                actions.complete(TourItems.NeedsSessionKey)
                actions.forceStart(TourItems.OnboardingComplete)
                return
            }
        }
    }, [wallet.connected, wallet.connecting, sessionActive, isProcessing, items, actions, hasExplored, isRestoring])

    // Find installed wallets
    const installedWallets = wallet.wallets.filter(
        w => w.readyState === 'Installed' || w.readyState === 'Loadable'
    )

    const handleWalletSelect = useCallback((walletName: string) => {
        wallet.select(walletName as any)
    }, [wallet])

    // =========================================================================
    // State 2: NeedsSessionKey - Wallet connected, create session key
    // =========================================================================
    const handleCreateSessionKey = useCallback(async () => {
        if (!wallet.publicKey || !wallet.signTransaction) {
            setError("Wallet not properly connected")
            return
        }

        setIsProcessing(true)
        setError(null)
        setSetupStep("deriving")
        setStepStatus({ derive: false, authorize: false, fund: false, init: false, delegate: false })

        try {
            await createSessionKey({
                onKeyDerived: async (keypair) => {
                    setStepStatus(prev => ({ ...prev, derive: true }))
                    setSetupStep("authorizing")
                    
                    // Check if already set up
                    try {
                        const bal = await connection.getBalance(keypair.publicKey)
                        const status = await checkUserDelegation(keypair.publicKey)
                        
                        if (bal >= 0.005 * LAMPORTS_PER_SOL && status === "delegated") {
                            // Already fully set up, animate through steps
                            setStepStatus(prev => ({ ...prev, authorize: true, fund: true, init: true, delegate: true }))
                            setSetupStep(null)
                            actions.complete(TourItems.NeedsSessionKey)
                            actions.forceStart(TourItems.OnboardingComplete)
                            return false
                        }
                    } catch {}
                    return true
                },
                onCreateAccount: async (keypair, owner, signature, message) => {
                    setStepStatus(prev => ({ ...prev, authorize: true }))
                    
                    // Check what we need to do
                    let needsFunding = true
                    let needsInit = true
                    let needsDelegate = true

                    try {
                        const bal = await connection.getBalance(keypair.publicKey)
                        needsFunding = bal < 0.005 * LAMPORTS_PER_SOL
                        const status = await checkUserDelegation(keypair.publicKey)
                        if (status === "delegated") { needsInit = false; needsDelegate = false }
                        else if (status === "undelegated") { needsInit = false }
                    } catch {}

                    // Fund
                    setSetupStep("funding")
                    if (needsFunding) {
                        const tx = new Transaction().add(
                            SystemProgram.transfer({
                                fromPubkey: owner,
                                toPubkey: keypair.publicKey,
                                lamports: MIN_SESSION_BALANCE * LAMPORTS_PER_SOL,
                            })
                        )
                        tx.feePayer = owner
                        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
                        const signedTx = await wallet.signTransaction!(tx)
                        const sig = await connection.sendRawTransaction(signedTx.serialize())
                        await connection.confirmTransaction(sig, "confirmed")
                    }
                    setStepStatus(prev => ({ ...prev, fund: true }))

                    // Initialize
                    setSetupStep("initializing")
                    if (needsInit) {
                        try {
                            await initializeUser(keypair, owner, signature, message)
                        } catch (e) {
                            if (!String(e).includes("already in use")) throw e
                        }
                    }
                    setStepStatus(prev => ({ ...prev, init: true }))

                    // Delegate
                    setSetupStep("delegating")
                    if (needsDelegate) {
                        await delegateUser(keypair, owner)
                    }
                    setStepStatus(prev => ({ ...prev, delegate: true }))

                    return "done"
                },
            })

            setSetupStep(null)
            actions.complete(TourItems.NeedsSessionKey)
            actions.forceStart(TourItems.OnboardingComplete)
        } catch (err) {
            console.error("Setup failed:", err)
            setError(err instanceof Error ? err.message : "Setup failed. Please try again.")
            setSetupStep(null)
        } finally {
            setIsProcessing(false)
        }
    }, [wallet, connection, createSessionKey, checkUserDelegation, initializeUser, delegateUser, actions])

    // =========================================================================
    // State 5: OnboardingComplete - All set up, explain features
    // =========================================================================
    const handleOnboardingComplete = useCallback(() => {
        actions.complete(TourItems.OnboardingComplete)
    }, [actions])

    // =========================================================================
    // Render Logic - Priority-based content selection
    // =========================================================================
    // Use useMemo to prevent re-renders of the content when typing in input
    const content = useMemo(() => {
        // Priority 1: Onboarding Intro (pixel click without wallet)
        if (items[TourItems.OnboardingIntro] === TourStateValues.InProgress) {
            return (
                <TourDialogue
                    title={<>Welcome to <span className="text-green-600">pixels.earth</span>! 🎨</>}
                    description={<div className="text-sm">This is a massive pixel canvas powered by Solana.<br/>Connect your wallet to start creating!</div>}
                    footer={
                        <button 
                            onClick={() => {
                                setHasExplored(true)
                                actions.complete(TourItems.OnboardingIntro)
                            }}
                            className="text-zinc-400 hover:text-slate-600 text-[10px] uppercase tracking-wider font-semibold underline underline-offset-2 transition-colors cursor-pointer"
                        >
                            Just explore for now →
                        </button>
                    }
                >
                    {wallet.connecting ? (
                        <div className="flex items-center justify-center gap-2 py-4 px-6 w-fit">
                            <SpinnerIcon size={20} />
                            <span className="text-slate-600 font-medium">Connecting...</span>
                        </div>
                    ) : (
                        <div className="w-full flex flex-col gap-1 items-center justify-center">
                            <div className="flex flex-wrap gap-1 p-2 items-center justify-center w-fit mx-auto max-h-[140px] overflow-y-auto px-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                {installedWallets.map((w) => (
                                    <button
                                        key={w.adapter.name}
                                        onClick={() => handleWalletSelect(w.adapter.name)}
                                        className="flex items-center gap-2 px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 hover:border-indigo-100 rounded-lg transition-all active:scale-[0.98] w-fit mx-auto group shrink-0"
                                    >
                                        <img 
                                            src={w.adapter.icon} 
                                            alt={w.adapter.name} 
                                            className="w-5 h-5 rounded-md shadow-sm"
                                        />
                                        <span className="font-bold text-slate-700 text-sm group-hover:text-indigo-700 transition-colors">{w.adapter.name}</span>
                                    </button>
                                ))}
                            </div>
                            {installedWallets.length === 0 && (
                                <div className="flex flex-col items-center gap-1 w-full mt-0">
                                    <span className="text-xs text-slate-500 font-medium">
                                        No wallet detected
                                    </span>
                                    <a 
                                        href="https://phantom.app/" 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-2 px-4 py-1.5 w-fit bg-[#551BF9] hover:bg-[#4615cf] text-white rounded-lg transition-all font-bold text-sm shadow-sm hover:shadow-md active:scale-[0.98]"
                                    >
                                        <span>Install Phantom</span>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                            <polyline points="15 3 21 3 21 9" />
                                            <line x1="10" y1="14" x2="21" y2="3" />
                                        </svg>
                                    </a>
                                </div>
                            )}
                        </div>
                    )}
                </TourDialogue>
            )
        }

        // Priority 2: Needs Session Key (with full setup flow)
        if (items[TourItems.NeedsSessionKey] === TourStateValues.InProgress) {
            if (isProcessing || setupStep) {
                return (
                    <TourDialogue
                        title="Setting up your Session... ⚙️"
                        description="Creating a high-speed signer for instant play."
                    >
                        <div className="flex flex-col gap-1 w-fit bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                            <StepIndicator label="Derive session key" done={stepStatus.derive} active={setupStep === "deriving"} />
                            <StepIndicator label="Authorize session" done={stepStatus.authorize} active={setupStep === "authorizing"} />
                            <div className="flex items-center justify-between w-full gap-1">
                                <StepIndicator label="Fund gas (0.01 SOL)" done={stepStatus.fund} active={setupStep === "funding"} />
                                <a href="https://faucet.solana.com/" target="_blank" className="text-xs text-blue-500 hover:text-blue-700 font-medium underline">Need SOL?</a>
                            </div>
                            <StepIndicator label="Initialize account" done={stepStatus.init} active={setupStep === "initializing"} />
                            <StepIndicator label="Enable fast mode" done={stepStatus.delegate} active={setupStep === "delegating"} />
                        </div>
                        {error && (
                            <div className="flex flex-col items-center gap-2 w-full">
                                <p className="text-red-500 text-sm font-medium text-center">{error}</p>
                                <Button onClick={handleCreateSessionKey} className="w-full">Try Again</Button>
                            </div>
                        )}
                    </TourDialogue>
                )
            }

            return (
                <TourDialogue
                    title={<>Set up your <span className="text-indigo-600">Session</span> 🔑</>}
                    description={<div className="text-sm w-full">Session keys let you place pixels <span className="text-indigo-600 font-bold">instantly</span><br/> without wallet popups every time!</div>}
                >
                    <div className="p-2 space-y-1.5 w-fit">
                        <div className="flex items-center gap-3 text-slate-700">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">1</div>
                            <span className="font-medium text-sm">One-time setup (just need to sign a message)</span>
                        </div>
                        <div className="flex items-center gap-3 text-slate-700">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">2</div>
                            <span className="font-medium text-sm">Small top up for fees (~0.01 SOL)</span>
                        </div>
                    </div>
                    
                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                    
                    <Button 
                        onClick={handleCreateSessionKey} 
                        disabled={sessionLoading}
                        className="w-fit py-4 text-base rounded-xl shadow-md hover:shadow-lg transition-all"
                    >
                        {sessionLoading ? "Processing..." : "Start Setup 🚀"}
                    </Button>
                </TourDialogue>
            )
        }



        // Priority 2.5: Needs Nickname
        if (items[TourItems.NeedsNickname] === TourStateValues.InProgress) {
            return (
                <TourDialogue
                    title="Choose a Nickname 👤"
                    description="How should we call you on the map?"
                >
                    <div className="w-full space-y-3 p-1 flex flex-col items-center justify-center">
                        <input
                            ref={nicknameInputRef}
                            type="text"
                            placeholder="Enter a display name..."
                            maxLength={20}
                            // autoFocus
                            autoFocus
                            className="w-2/3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                            onKeyDown={(e) => { 
                                if (e.key === 'Enter' && nicknameInputRef.current?.value.trim()) {
                                    setNickname(nicknameInputRef.current.value.trim());
                                    actions.complete(TourItems.NeedsNickname);
                                }
                            }}
                        />
                        <Button 
                            onClick={() => {
                                if (nicknameInputRef.current?.value.trim()) {
                                    setNickname(nicknameInputRef.current.value.trim())
                                    actions.complete(TourItems.NeedsNickname)
                                }
                            }} 
                            // disabled={!nicknameInputRef.current?.value.trim()} // Cannot reactively disable
                            className="w-fit"
                        >
                            Continue
                        </Button>
                    </div>
                </TourDialogue>
            )
        }

        // Priority 5: Onboarding Complete
        if (items[TourItems.OnboardingComplete] === TourStateValues.InProgress) {
            return (
                <TourDialogue
                    className="w-full"
                    title="You're all set! 🎉"
                    // description={<>Welcome to the canvas. Here is how it works:</>}
                >
                    <div className="flex flex-col bg-white p-1 text-left">
                        <div className="flex gap-2.5 items-start">
                            <span className="text-lg">🖌️</span>
                            <p className="text-sm text-slate-600 leading-snug font-medium">Click any pixel to paint it with your selected color.</p>
                        </div>
                        <div className="flex gap-2.5 items-start">
                            <span className="text-lg">💎</span>
                            <p className="text-sm text-slate-600 leading-snug font-medium">Unlock shards to <span className="text-emerald-600 font-bold">earn SOL</span> when others paint there.</p>
                        </div>
                        <div className="flex gap-2.5 items-start">
                            <span className="text-lg">⚡</span>
                            <p className="text-sm text-slate-600 leading-snug font-medium">Painting on shards you own is completely <span className="text-emerald-600 font-bold">free</span>.</p>
                        </div>
                    </div>
                    <Button onClick={handleOnboardingComplete} className="w-fit mt-0 ">
                        Let's Paint! 🎨
                    </Button>
                </TourDialogue>
            )
        }

        // =====================================================================
        // Contextual Tour Items (triggered by user actions)
        // =====================================================================

        if (items[TourItems.ClickedOnLockedShard] === TourStateValues.InProgress) {
            return (
                <TourDialogue
                    title="This shard is locked! 🔒"
                    description={<div className="text-sm">
                        Unlock it to place pixels <span className="text-emerald-600 font-bold">freely</span> and bypass cooldowns!
                       <div className="flex flex-col items-center gap-2">
                            <p className="text-sm">
                                Owners <span className="text-emerald-600 font-bold">earn SOL</span> when others skip cooldowns.
                            </p>
                       </div>
                        <div className="flex items-center justify-center gap-1 mt-2 text-center">
                            Click on the <ScanEye className="text-black"/> at top left to view all shard details
                       </div>
                    </div>}
                >
                    <Button onClick={() => actions.complete(TourItems.ClickedOnLockedShard)} className="w-">
                        Got it!
                    </Button>
                </TourDialogue>
            )
        }

        if (items[TourItems.UnlockedShard] === TourStateValues.InProgress) {
            return (
                 <TourDialogue
                    title="Congratulations! 🎉"
                    description={<>
                        You now <span className="text-indigo-600 font-bold">own</span> this shard!
                    </>}
                >
                    <div className="bg-emerald-50 rounded-xl p-3 w-full text-center border border-emerald-100">
                        <p className="text-emerald-800 font-medium text-sm">
                            ✨ No cooldowns for you here!<br/>
                            💰 You earn SOL from premiums!
                        </p>
                    </div>
                    <Button onClick={() => actions.complete(TourItems.UnlockedShard)} className="w-full">
                        Awesome! 🚀
                    </Button>
                </TourDialogue>
            )
        }

        if (items[TourItems.LowSessionBalance] === TourStateValues.InProgress && topupRequest) {
            const suggestedAmount = Math.max(0.01, Math.ceil((topupRequest.amountNeeded - (sessionBalance || 0) + 0.005) * 100) / 100)
            return (
                 <TourDialogue
                    title="Low Session Gas ⛽"
                    description={topupRequest.reason}
                    footer={
                        <a href="https://faucet.solana.com/" target="_blank" className="text-xs text-slate-400 hover:text-slate-600 underline">Need devnet SOL?</a>
                    }
                >
                    <div className="bg-slate-50 rounded-xl p-2 px-4 w-fit border border-slate-100 space-y-1.5">
                         <div className="flex justify-between items-center text-sm gap-2    ">
                            <span className="text-slate-500">Current Balance</span>
                            <span className="font-mono font-medium text-slate-900">{(sessionBalance || 0).toFixed(4)} SOL</span>
                        </div>
                        <div className="flex justify-between items-center text-sm gap-2">
                            <span className="text-slate-500">Required</span>
                            <span className="font-mono font-bold text-red-500">{topupRequest.amountNeeded.toFixed(4)} SOL</span>
                        </div>
                        <div className="h-px bg-slate-200 w-full my-0.5" />
                        <div className="flex justify-between items-center text-sm gap-2">
                            <span className="text-slate-600 font-bold">Top Up Amount</span>
                            <span className="font-mono font-bold text-emerald-600">{suggestedAmount.toFixed(3)} SOL</span>
                        </div>
                    </div>
                    
                    {error && <p className="text-red-500 text-sm">{error}</p>}

                    <div className="flex gap-3 w-fit">
                         <Button variant="outline" onClick={handleCancelTopup} disabled={isTopupLoading} className="flex-1">
                            Cancel
                        </Button>
                        <Button onClick={handleTopup} disabled={isTopupLoading} className="flex-1" style={{ flex: 2 }}>
                            {isTopupLoading ? "Processing..." : "Top Up Now"}
                        </Button>
                    </div>
                </TourDialogue>
            )
        }

        if (items[TourItems.PixelPlaceWithoutLogin] === TourStateValues.InProgress) {
             return (
                <TourDialogue
                    title="Connect to Paint 🎨"
                    description="You need a wallet to leave your mark."
                >
                     {installedWallets.slice(0, 2).map((w) => (
                        <button
                            key={w.adapter.name}
                            onClick={() => {
                                handleWalletSelect(w.adapter.name)
                                actions.complete(TourItems.PixelPlaceWithoutLogin)
                            }}
                            className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all active:scale-[0.98] w-full"
                        >
                            <img src={w.adapter.icon} alt={w.adapter.name} className="w-6 h-6 rounded-lg"/>
                            <span className="font-semibold text-slate-700">Connect {w.adapter.name}</span>
                        </button>
                    ))}
                </TourDialogue>
            )
        }

        if (items[TourItems.CooldownLimitReached] === TourStateValues.InProgress) {
            return (
                <TourDialogue
                    title="Cooldown Active! ⏳"
                    description={<>You've placed <span className="text-blue-600 font-bold">50 pixels</span>.</>}
                >
                    <div className="w-full text-left space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                         <p className="text-sm text-slate-600">Wait 30s or:</p>
                         <ul className="text-sm text-slate-700 space-y-1 font-medium">
                            <li className="flex items-center gap-2">💎 <span className="text-amber-600">Pay premium</span> to bypass</li>
                            <li className="flex items-center gap-2">🔓 <span className="text-emerald-600">Unlock shard</span> to bypass forever</li>
                        </ul>
                    </div>
                    <Button onClick={() => actions.complete(TourItems.CooldownLimitReached)} className="w-full">
                        Got it!
                    </Button>
                </TourDialogue>
            )
        }

        if (items[TourItems.CooldownCompleted] === TourStateValues.InProgress) {
            return (
                <TourDialogue
                    title="Ready to Paint! 🎨"
                    description="Your cooldown is over."
                >
                    <Button onClick={() => actions.complete(TourItems.CooldownCompleted)} className="w-full">
                        Let's Go!
                    </Button>
                </TourDialogue>
            )
        }

        return null
    }, [
        items, 
        wallet.connecting, 
        wallet.connected, 
        isProcessing, 
        setupStep, 
        stepStatus, 
        error, 
        sessionLoading, 
        topupRequest, 
        sessionBalance, 
        isTopupLoading, 
        installedWallets, 
        actions, 
        handleCreateSessionKey, 
        handleOnboardingComplete, 
        handleWalletSelect, 
        handleTopup, 
        handleCancelTopup,
        setNickname,
        setHasExplored
    ])

    return (
        <Character>
            {content}
        </Character>
    )
}