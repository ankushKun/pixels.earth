import { useState, useCallback } from "react";
import { useSessionKey } from "@/hooks/use-session-key";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { useMagicplaceProgram } from "@/hooks/use-magicplace-program";

// ============================================================================
// Icons
// ============================================================================

const CheckIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const SpinnerIcon = ({ size = 16 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/>
    <path d="M12 2C6.48 2 2 6.48 2 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
  </svg>
);

const PixelIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-900">
    <rect width="18" height="18" x="3" y="3" rx="2" strokeWidth="1.5"/>
    <path d="M3 9h18"/>
    <path d="M9 21V9"/>
    <path d="M3 15h6"/>
    <path d="M15 9v12"/>
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

  // Main setup handler (Same logic as before, just kept for context)
  const handleSetup = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setError("Wallet not properly connected");
      return;
    }

    setStep("deriving");
    setError(null);

    try {
      await createSessionKey({
        onKeyDerived: async (keypair) => {
          setStepStatus(prev => ({ ...prev, derive: true }));
          setStep("authorizing");
          try {
            const balance = await connection.getBalance(keypair.publicKey);
            const status = await checkUserDelegation(keypair.publicKey);
            
            if (balance >= 0.005 * LAMPORTS_PER_SOL && status === "delegated") {
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
              return false;
            }
          } catch {}
          return true;
        },
        onCreateAccount: async (keypair, owner, signature, message) => {
          setStepStatus(prev => ({ ...prev, authorize: true }));
          let needsFunding = true;
          let needsInit = true;
          let needsDelegate = true;

          try {
            const balance = await connection.getBalance(keypair.publicKey);
            needsFunding = balance < 0.005 * LAMPORTS_PER_SOL;
            const status = await checkUserDelegation(keypair.publicKey);
            if (status === "delegated") { needsInit = false; needsDelegate = false; }
            else if (status === "undelegated") { needsInit = false; }
          } catch {}

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

          setStep("initializing");
          if (needsInit) {
            try {
              await initializeUser(keypair, owner, signature, message);
            } catch (e) {
              if (!String(e).includes("already in use")) throw e;
            }
          }
          setStepStatus(prev => ({ ...prev, init: true }));

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
    <div className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-[2.5rem] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.2)] max-w-[24rem] w-full overflow-hidden border border-zinc-100 p-8 transform transition-all">
        
        {/* Header */}
        <div className="flex flex-col items-center text-center">
             {step === "complete" ? (
                <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6 shadow-inner text-emerald-500 animate-[bounce_1s_infinite]">
                    <CheckIcon size={40} />
                </div>
             ) : (
                <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6 shadow-sm relative text-indigo-500">
                    <PixelIcon />
                </div>
             )}
          
          <h1 className="text-2xl font-extrabold text-slate-900 mb-2">
            {step === "complete" ? "Ready to Paint!" : "Setup Session"}
          </h1>
          <p className="text-slate-500 text-[0.95rem] leading-relaxed mb-8 max-w-[20rem] font-medium">
            {step === "complete" 
              ? "Your session is secured. Start placing pixels instantly." 
              : "Enable session keys for a seamless, popup-free experience."
            }
          </p>
        </div>

        {/* Content */}
        <div>
          {step === "idle" && (
            <div className="space-y-6">
               <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 text-sm font-bold text-indigo-600">1</div>
                  <div>
                    <div className="font-bold text-slate-800 text-sm">No Popups</div>
                    <div className="text-xs text-slate-500 font-medium">Draw without confirming every pixel</div>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 text-sm font-bold text-indigo-600">2</div>
                  <div>
                     <div className="font-bold text-slate-800 text-sm">Auto-Pay Gas</div>
                     <div className="text-xs text-slate-500 font-medium">Funds a tiny amount (0.01 SOL)</div>
                  </div>
                </div>
               </div>

              <button
                onClick={handleSetup}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-full shadow-[0_4px_14px_0_rgba(99,102,241,0.39)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.23)] hover:-translate-y-0.5 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                Start Setup
              </button>
            </div>
          )}

          {step !== "idle" && step !== "error" && (
            <div className="space-y-3 mt-2">
              <StepIndicator label="Derive session key" done={stepStatus.derive} active={step === "deriving"} />
              <StepIndicator label="Authorize session key" done={stepStatus.authorize} active={step === "authorizing"} />
              <StepIndicator label="Fund gas (0.01 SOL)" done={stepStatus.fund} active={step === "funding"} />
              <StepIndicator label="Initialize account" done={stepStatus.init} active={step === "initializing"} />
              <StepIndicator label="Enable Ephemeral Rollup" done={stepStatus.delegate} active={step === "delegating"} />
              
              {step === "complete" && (
                <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <button
                    onClick={onComplete}
                    className="w-full py-4 bg-slate-900 hover:bg-black text-white font-bold rounded-full shadow-[0_4px_14px_0_rgba(0,0,0,0.39)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.23)] hover:-translate-y-0.5 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    Enter Canvas
                  </button>
                </div>
              )}
            </div>
          )}

          {step === "error" && (
            <div className="space-y-6 mt-4">
              <div className="p-4 bg-red-50 rounded-2xl border border-red-100 text-center">
                <p className="text-red-600 font-bold text-sm">{error}</p>
              </div>
              <button
                onClick={reset}
                className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-full transition-all active:scale-95"
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
    <div className={`flex items-center gap-4 transition-colors duration-300 ${active ? "opacity-100" : "opacity-60"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 border ${
        done 
          ? "bg-indigo-500 border-indigo-500 text-white" 
          : active 
            ? "bg-white border-indigo-600 text-indigo-600 shadow-[0_0_0_2px_rgba(79,70,229,0.2)]" 
            : "bg-slate-50 border-slate-200 text-slate-300"
      }`}>
        {done ? (
          <CheckIcon size={16} />
        ) : active ? (
          <SpinnerIcon size={16} />
        ) : (
          <div className="w-1.5 h-1.5 rounded-full bg-current" />
        )}
      </div>
      <span className={`text-sm font-bold transition-colors duration-300 ${
        done ? "text-indigo-900" : active ? "text-indigo-900" : "text-slate-400"
      }`}>
        {label}
      </span>
    </div>
  );
}
