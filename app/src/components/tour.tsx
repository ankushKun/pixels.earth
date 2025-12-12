import { useState, useEffect, useCallback } from "react"
import { useSessionKey } from "@/hooks/use-session-key"
import { useTourActions, useTourItems, TourItems, TourStateValues } from "../hooks/use-tour"
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

export default function Tour() {
    const items = useTourItems()
    const actions = useTourActions()
    const { sessionKey, isActive: sessionActive, createSessionKey, isLoading: sessionLoading } = useSessionKey()
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
                return
            }

            // If we're in session key step and session is already active, skip to complete
            if (currentSessionKey === TourStateValues.InProgress && sessionActive && !isProcessing) {
                actions.complete(TourItems.NeedsSessionKey)
                actions.forceStart(TourItems.OnboardingComplete)
                return
            }
        }
    }, [wallet.connected, wallet.connecting, sessionActive, isProcessing, items, actions, hasExplored])

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
    const getContent = (): React.ReactNode => {
        // Priority 1: Onboarding Intro (pixel click without wallet)
        if (items[TourItems.OnboardingIntro] === TourStateValues.InProgress) {
            return (
                <div className="flex flex-col gap-3">
                    <p className="text-lg font-bold">
                        Welcome to <span className="text-indigo-600">pixels.earth</span>! 🎨
                    </p>
                    <p className="text-sm text-slate-600">
                        This is a massive pixel canvas powered by Solana.<br/> Connect your wallet to start creating!
                    </p>
                    
                    {wallet.connecting ? (
                        <div className="flex items-center justify-center gap-2 py-3">
                            <SpinnerIcon size={20} />
                            <span className="text-slate-600">Connecting...</span>
                        </div>
                    ) : (
                        <div className="flex gap-2 mt-2 items-center justify-center">
                            {installedWallets.map((w) => (
                                <button
                                    key={w.adapter.name}
                                    onClick={() => handleWalletSelect(w.adapter.name)}
                                    className="flex items-center gap-3 p-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all active:scale-[0.98]"
                                >
                                    <img 
                                        src={w.adapter.icon} 
                                        alt={w.adapter.name} 
                                        className="w-7 h-7 rounded-lg"
                                    />
                                    {/* <span className="font-semibold text-slate-700">{w.adapter.name}</span> */}
                                </button>
                            ))}
                        </div>
                    )}
                    <button 
                        onClick={() => {
                            setHasExplored(true)
                            actions.complete(TourItems.OnboardingIntro)
                        }}
                        className="text-slate-400 hover:text-slate-600 text-xs mt-3 underline underline-offset-2 transition-colors cursor-pointer"
                    >
                        Just explore for now →
                    </button>
                </div>
            )
        }

        // Priority 2: Needs Session Key (with full setup flow)
        if (items[TourItems.NeedsSessionKey] === TourStateValues.InProgress) {
            if (isProcessing || setupStep) {
                return (
                    <div className="flex flex-col gap-3">
                        <p className="text-lg font-bold">Setting up your session...</p>
                        <div className="flex flex-col gap-2 mt-2">
                            <StepIndicator label="Derive session key" done={stepStatus.derive} active={setupStep === "deriving"} />
                            <StepIndicator label="Authorize session" done={stepStatus.authorize} active={setupStep === "authorizing"} />
                           <div className="flex items-center gap-1"> <StepIndicator label="Fund gas (0.01 SOL)" done={stepStatus.fund} active={setupStep === "funding"} /> <span className="text-xs text-blue-600"> [<a href="https://faucet.solana.com/" className="underline underline-offset-2">devnet faucet</a>]</span></div>
                            <StepIndicator label="Initialize account" done={stepStatus.init} active={setupStep === "initializing"} />
                            <StepIndicator label="Enable fast mode" done={stepStatus.delegate} active={setupStep === "delegating"} />
                        </div>
                        {error && (
                            <>
                                <p className="text-red-500 text-sm mt-2">{error}</p>
                                <Button onClick={handleCreateSessionKey} className="mt-2">
                                    Retry
                                </Button>
                            </>
                        )}
                    </div>
                )
            }

            return (
                <div className="flex flex-col gap-3">
                    <p className="text-lg font-bold">
                        Let's set up your <span className="text-indigo-600">Session</span> 🔑
                    </p>
                    <p className="text-sm text-slate-600">
                        Session keys let you place pixels <span className="text-indigo-600 font-medium">instantly</span> without popups.
                    </p>
                    {/* <div className="bg-slate-50 rounded-xl p-3 space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-indigo-600">•</span>
                            <span>2 signature approvals</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-indigo-600">•</span>
                            <span>0.01 SOL for gas fees</span>
                        </div>
                    </div> */}
                    {error && (
                        <p className="text-red-500 text-sm">{error}</p>
                    )}
                    <Button onClick={handleCreateSessionKey} disabled={sessionLoading} className="mt-2">
                        {sessionLoading ? "Processing..." : "Start Setup"}
                    </Button>
                </div>
            )
        }

        // Skip NeedsTopup and NeedsAccountInit - handled in the session key flow now

        // Priority 5: Onboarding Complete
        if (items[TourItems.OnboardingComplete] === TourStateValues.InProgress) {
            return (
                <div className="flex flex-col gap-2">
                    <p className="text-2xl font-bold">
                        You're all set!
                    </p>
                    <ul className="text-sm text-slate-600 space-y-1">
                        <li>Click any pixel to place your color</li>
                        <li>Unlock shards to <span className="text-emerald-600 font-medium">earn SOL</span> from premiums!</li>
                        <li>Placing on unlocked shards is <span className="text-blue-600 font-medium">free</span></li>
                        <li>Shards you don't own have a cooldown</li>
                    </ul>
                    <Button onClick={handleOnboardingComplete} className="mt-2">
                        Let's Go! 🎨
                    </Button>
                </div>
            )
        }

        // =====================================================================
        // Contextual Tour Items (triggered by user actions)
        // =====================================================================

        if (items[TourItems.ClickedOnLockedShard] === TourStateValues.InProgress) {
            return (
                <div className="flex flex-col gap-2 items-center justify-center">
                    <p className="text-lg font-bold">
                        This shard is locked! 🔒
                    </p>
                    <p className="text-sm text-slate-600">
                        Unlock to place pixels <span className="text-blue-600 font-medium">freely</span> — no cooldowns!
                    </p>
                    <p className="text-sm text-slate-600">
                        Owners <span className="text-emerald-600 font-medium">earn SOL</span> when others skip cooldowns.
                    </p>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1 justify-center">
                        Tap <ScanEye className="w-4 h-4 inline text-black" /> (top-left) to see unlocked shards and their owners.
                    </p>
                    <Button onClick={() => actions.complete(TourItems.ClickedOnLockedShard)} className="w-fit mx-auto mt-2">
                        Got it!
                    </Button>
                </div>
            )
        }

        // Congratulate user on first shard unlock
        if (items[TourItems.UnlockedShard] === TourStateValues.InProgress) {
            return (
                <div className="flex flex-col items-center justify-center gap-3">
                    <p className="text-lg font-bold">
                        Congratulations! 🎉
                    </p>
                    <p className="text-sm text-slate-600">
                        You <span className="text-indigo-600 font-semibold">own</span> this shard — no cooldowns for you!
                    </p>
                    <p className="text-sm text-slate-600">
                        Others pay <span className="text-amber-600 font-semibold">premium</span> to skip cooldowns here. <br />
                        <span className="text-emerald-600 font-semibold">You earn</span> from every skip!
                    </p>
                    <Button onClick={() => actions.complete(TourItems.UnlockedShard)}>
                        Awesome! 🚀
                    </Button>
                </div>
            )
        }

        // Low Session Balance - prompt for topup
        if (items[TourItems.LowSessionBalance] === TourStateValues.InProgress && topupRequest) {
            const suggestedAmount = Math.max(0.01, Math.ceil((topupRequest.amountNeeded - (sessionBalance || 0) + 0.005) * 100) / 100)
            return (
                <div className="flex flex-col gap-1.5 items-center">
                    <p className="text-lg font-bold">
                        Low Session Balance 💰
                    </p>
                    <p className="text-sm text-slate-600">
                        {topupRequest.reason}
                    </p>
                    <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Current balance</span>
                            <span className="font-mono">{(sessionBalance || 0).toFixed(4)} SOL</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Needed</span>
                            <span className="font-mono text-red-600">{topupRequest.amountNeeded.toFixed(4)} SOL</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                            <span className="text-slate-700 font-medium">Top-up amount</span>
                            <span className="font-mono text-emerald-600">{suggestedAmount.toFixed(3)} SOL</span>
                        </div>
                    </div>
                    {error && (
                        <p className="text-red-500 text-sm">{error}</p>
                    )}
                    <div className="flex gap-2">
                        <Button onClick={handleTopup} disabled={isTopupLoading} className="flex-1">
                            {isTopupLoading ? "Processing..." : `Top Up ${suggestedAmount.toFixed(3)} SOL`}
                        </Button>
                        <Button variant="outline" onClick={handleCancelTopup} disabled={isTopupLoading}>
                            Cancel
                        </Button>
                    </div>
                    <a 
                        href="https://faucet.solana.com/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs underline text-white underline-offset-4 absolute -bottom-10 text-center mx-auto"
                    >
                        Need devnet SOL? Use Faucet
                    </a>
                </div>
            )
        }

        if (items[TourItems.PixelPlaceWithoutLogin] === TourStateValues.InProgress) {
            return (
                <div className="flex flex-col gap-3">
                    <p className="text-lg font-bold">
                        Connect your wallet! ✋
                    </p>
                    <p className="text-sm text-slate-600">
                        You need a Solana wallet to place pixels on the canvas.
                    </p>
                    {installedWallets.slice(0, 2).map((w) => (
                        <button
                            key={w.adapter.name}
                            onClick={() => {
                                handleWalletSelect(w.adapter.name)
                                actions.complete(TourItems.PixelPlaceWithoutLogin)
                            }}
                            className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all active:scale-[0.98]"
                        >
                            <img src={w.adapter.icon} alt={w.adapter.name} className="w-6 h-6 rounded-lg"/>
                            <span className="font-semibold text-slate-700">{w.adapter.name}</span>
                        </button>
                    ))}
                </div>
            )
        }

        // Cooldown started - explain limit system
        if (items[TourItems.CooldownLimitReached] === TourStateValues.InProgress) {
            return (
                <div className="flex flex-col gap-2 items-center justify-center">
                    <p className="text-lg font-bold">
                        Cooldown Active! ⏳
                    </p>
                    <p className="text-sm text-slate-600">
                        You've placed <span className="text-blue-600 font-medium">50 pixels</span> — wait 30s or:
                    </p>
                    <ul className="text-sm text-slate-600 space-y-1">
                        <li>• <span className="text-amber-600 font-medium">Pay premium</span> to bypass for 3 hours</li>
                        <li>• <span className="text-emerald-600 font-medium">Unlock a shard</span> to place freely forever</li>
                    </ul>
                    <p className="text-xs text-slate-400 mt-1">
                        Check the counter in <span className="font-medium">top-left</span> for your progress!
                    </p>
                    <Button onClick={() => actions.complete(TourItems.CooldownLimitReached)} className="w-fit">
                        Got it!
                    </Button>
                </div>
            )
        }

        // Cooldown completed - encourage to continue
        if (items[TourItems.CooldownCompleted] === TourStateValues.InProgress) {
            return (
                <div className="flex flex-col gap-3 items-center justify-center">
                    <p className="text-lg font-bold">
                        You're Back! 🎨
                    </p>
                    <p className="text-sm text-slate-600">
                        Cooldown's over — go place more pixels!
                    </p>
                    <Button onClick={() => actions.complete(TourItems.CooldownCompleted)} className="w-fit">
                        Let's Go!
                    </Button>
                </div>
            )
        }

        return null
    }

    const content = getContent()

    return (
        <Character>
            {content}
        </Character>
    )
}