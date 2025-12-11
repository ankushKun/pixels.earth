import { useState, useCallback } from "react";
import { useSessionKey } from "@/hooks/use-session-key";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { useMagicplaceProgram } from "@/hooks/use-magicplace-program";

// ============================================================================
// Icons
// ============================================================================

const CheckIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const SpinnerIcon = ({ size = 20 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/>
    <path d="M12 2C6.48 2 2 6.48 2 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
  </svg>
);

const PixelIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="7" x="3" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="14" rx="1"/>
    <rect width="7" height="7" x="3" y="14" rx="1"/>
  </svg>
);

// ============================================================================
// Types
// ============================================================================

type SetupStep = "idle" | "deriving" | "authorizing" | "funding" | "initializing" | "delegating" | "complete" | "error";

interface StepStatus {
  derive: boolean;
  authorize: boolean;
  fund: boolean;
  init: boolean;
  delegate: boolean;
}

interface Props {
  onComplete: () => void;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * OnboardingWalkthrough - Blocking modal for session key setup
 * 
 * This component blocks the UI until the user creates a session key.
 * It handles the entire flow: derive key → authorize → fund → initialize → delegate
 */
export default function OnboardingWalkthrough({ onComplete }: Props) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { createSessionKey, sessionKey } = useSessionKey();
  const { initializeUser, delegateUser, checkUserDelegation } = useMagicplaceProgram();
  
  const [step, setStep] = useState<SetupStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stepStatus, setStepStatus] = useState<StepStatus>({
    derive: false,
    authorize: false,
    fund: false,
    init: false,
    delegate: false,
  });

  // Reset function
  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setStepStatus({
      derive: false,
      authorize: false,
      fund: false,
      init: false,
      delegate: false,
    });
  }, []);

  // Main setup handler
  const handleSetup = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setError("Wallet not properly connected");
      return;
    }

    setStep("deriving");
    setError(null);

    try {
      await createSessionKey({
        // Called after first signature (key derivation)
        onKeyDerived: async (keypair) => {
          setStepStatus(prev => ({ ...prev, derive: true }));
          setStep("authorizing");

          // Check if already fully set up
          try {
            const balance = await connection.getBalance(keypair.publicKey);
            const status = await checkUserDelegation(keypair.publicKey);
            
            if (balance >= 0.005 * LAMPORTS_PER_SOL && status === "delegated") {
              // Already done - animate through steps for visual feedback
              const animateSteps = async () => {
                await new Promise(r => setTimeout(r, 300));
                setStepStatus(prev => ({ ...prev, authorize: true }));
                setStep("funding");
                
                await new Promise(r => setTimeout(r, 300));
                setStepStatus(prev => ({ ...prev, fund: true }));
                setStep("initializing");
                
                await new Promise(r => setTimeout(r, 300));
                setStepStatus(prev => ({ ...prev, init: true }));
                setStep("delegating");
                
                await new Promise(r => setTimeout(r, 300));
                setStepStatus(prev => ({ ...prev, delegate: true }));
                setStep("complete");
              };
              
              animateSteps();
              return false; // Skip second signature
            }
          } catch {
            // Not set up yet, continue
          }

          return true; // Continue to second signature
        },

        // Called after second signature (authorization)
        onCreateAccount: async (keypair, owner, signature, message) => {
          setStepStatus(prev => ({ ...prev, authorize: true }));

          // Check current state
          let needsFunding = true;
          let needsInit = true;
          let needsDelegate = true;

          try {
            const balance = await connection.getBalance(keypair.publicKey);
            needsFunding = balance < 0.005 * LAMPORTS_PER_SOL;

            const status = await checkUserDelegation(keypair.publicKey);
            if (status === "delegated") {
              needsInit = false;
              needsDelegate = false;
            } else if (status === "undelegated") {
              needsInit = false;
            }
          } catch {
            // Account doesn't exist
          }

          // Step 1: Fund if needed
          setStep("funding");
          if (needsFunding) {
            const tx = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: owner,
                toPubkey: keypair.publicKey,
                lamports: 0.01 * LAMPORTS_PER_SOL,
              })
            );
            tx.feePayer = owner;
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            
            const signedTx = await wallet.signTransaction!(tx);
            const sig = await connection.sendRawTransaction(signedTx.serialize());
            await connection.confirmTransaction(sig, "confirmed");
          }
          setStepStatus(prev => ({ ...prev, fund: true }));

          // Step 2: Initialize if needed
          setStep("initializing");
          if (needsInit) {
            try {
              await initializeUser(keypair, owner, signature, message);
            } catch (e) {
              // Ignore "already in use" errors
              if (!String(e).includes("already in use")) {
                throw e;
              }
            }
          }
          setStepStatus(prev => ({ ...prev, init: true }));

          // Step 3: Delegate if needed
          setStep("delegating");
          if (needsDelegate) {
            await delegateUser(keypair, owner);
          }
          setStepStatus(prev => ({ ...prev, delegate: true }));

          setStep("complete");
          return "done";
        },
      });
    } catch (e) {
      console.error("Setup failed:", e);
      setError(e instanceof Error ? e.message : "Setup failed. Please try again.");
      setStep("error");
    }
  }, [wallet, connection, createSessionKey, checkUserDelegation, initializeUser, delegateUser]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-white/20 flex items-center justify-center">
            <PixelIcon />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {step === "complete" ? "Setup Complete!" : "Setup Required"}
          </h1>
          <p className="text-blue-100 mt-2 text-sm">
            {step === "complete" 
              ? "You're ready to start painting" 
              : "Create a session key to start painting"
            }
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === "idle" && (
            <>
              <p className="text-slate-600 text-center mb-6">
                Session keys let you paint without approving every transaction. 
                This requires a small amount of SOL (~0.01) and a few signatures.
              </p>
              <button
                onClick={handleSetup}
                className="w-full py-3 px-6 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl shadow-lg transition-all"
              >
                Create Session Key
              </button>
            </>
          )}

          {step !== "idle" && step !== "error" && (
            <div className="space-y-4">
              <StepIndicator label="Derive session key" done={stepStatus.derive} active={step === "deriving"} />
              <StepIndicator label="Authorize session key" done={stepStatus.authorize} active={step === "authorizing"} />
              <StepIndicator label="Fund session key (0.01 SOL)" done={stepStatus.fund} active={step === "funding"} />
              <StepIndicator label="Initialize on-chain account" done={stepStatus.init} active={step === "initializing"} />
              <StepIndicator label="Delegate to Ephemeral Rollup" done={stepStatus.delegate} active={step === "delegating"} />
              
              {step === "complete" && (
                <>
                  {sessionKey.publicKey && (
                    <div className="mt-4 text-xs text-slate-500 font-mono bg-slate-100 p-3 rounded-lg">
                      <div className="text-slate-400 mb-1">Session Key:</div>
                      {sessionKey.publicKey.toBase58()}
                    </div>
                  )}
                  
                  <button
                    onClick={onComplete}
                    className="w-full mt-4 py-3 px-6 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl shadow-lg transition-all"
                  >
                    Start Painting →
                  </button>
                </>
              )}
            </div>
          )}

          {step === "error" && (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 rounded-xl border border-red-200">
                <div className="text-red-600 font-semibold mb-1">Setup Failed</div>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
              <button
                onClick={reset}
                className="w-full py-3 px-6 bg-slate-500 hover:bg-slate-600 text-white font-semibold rounded-xl shadow-lg transition-all"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface StepIndicatorProps {
  label: string;
  done: boolean;
  active: boolean;
}

function StepIndicator({ label, done, active }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
        done 
          ? "bg-emerald-500 text-white" 
          : active 
            ? "bg-blue-500 text-white" 
            : "bg-slate-200 text-slate-400"
      }`}>
        {done ? (
          <CheckIcon size={14} />
        ) : active ? (
          <SpinnerIcon size={14} />
        ) : (
          <div className="w-2 h-2 rounded-full bg-current" />
        )}
      </div>
      <span className={`text-sm ${
        done ? "text-slate-700" : active ? "text-blue-600 font-medium" : "text-slate-400"
      }`}>
        {label}
      </span>
    </div>
  );
}
