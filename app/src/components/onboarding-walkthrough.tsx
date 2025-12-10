import { useState, useCallback } from "react";
import { useSessionKey } from "@/hooks/use-session-key";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useMagicplaceProgram } from "@/hooks/use-magicplace-program";

// Minimal icons matching app style
const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const LoadingSpinner = () => (
  <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/>
    <path d="M12 2C6.48 2 2 6.48 2 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
  </svg>
);

interface WalkthroughStep {
  id: string;
  title: string;
  description: string;
  content?: React.ReactNode;
}

interface OnboardingWalkthroughProps {
  onComplete: () => void;
  onSkip: () => void;
}

export default function OnboardingWalkthrough({ onComplete, onSkip }: OnboardingWalkthroughProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionCreated, setSessionCreated] = useState(false);
  const [topUpComplete, setTopUpComplete] = useState(false);
  
  const { sessionKey, createSessionKey, isActive } = useSessionKey();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { initializeUser } = useMagicplaceProgram();

  const handleCreateSessionKey = useCallback(async () => {
    if (isActive) {
      setSessionCreated(true);
      return;
    }
    
    setIsLoading(true);
    try {
      // Create session key with on-chain account creation
      await createSessionKey({
        onCreateAccount: initializeUser,
      });
      setSessionCreated(true);
    } catch (error) {
      console.error("Failed to create session key:", error);
    } finally {
      setIsLoading(false);
    }
  }, [createSessionKey, isActive, initializeUser]);

  const handleTopUpSessionKey = useCallback(async () => {
    if (!sessionKey.publicKey || !wallet.publicKey || !wallet.signTransaction) {
      console.error("Session key or wallet not available");
      return;
    }
    
    setIsLoading(true);
    try {
      const amountLamports = 0.01 * LAMPORTS_PER_SOL;
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: sessionKey.publicKey,
          lamports: amountLamports,
        })
      );
      
      transaction.feePayer = wallet.publicKey;
      const latestBlockhash = await connection.getLatestBlockhash();
      transaction.recentBlockhash = latestBlockhash.blockhash;
      
      const signedTx = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(signature, "confirmed");
      
      setTopUpComplete(true);
    } catch (error) {
      console.error("Failed to top up session key:", error);
    } finally {
      setIsLoading(false);
    }
  }, [sessionKey.publicKey, wallet, connection]);

  const steps: WalkthroughStep[] = [
    {
      id: "welcome",
      title: "Welcome to Magicplace",
      description: "Your collaborative pixel canvas on Solana. Place pixels, create art, and own your creations on-chain.",
      content: null, // Welcome screen is special
    },
    {
      id: "explore-canvas",
      title: "Explore the Canvas",
      description: "Navigate the canvas using your mouse. Scroll to zoom, drag to pan, and click to select pixels.",
      content: (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
            <div className="text-slate-600 font-medium mb-1">Pan</div>
            <div className="text-sm text-slate-400">Click & drag</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
            <div className="text-slate-600 font-medium mb-1">Zoom</div>
            <div className="text-sm text-slate-400">Scroll wheel</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
            <div className="text-slate-600 font-medium mb-1">Select</div>
            <div className="text-sm text-slate-400">Click pixel</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
            <div className="text-slate-600 font-medium mb-1">Paint</div>
            <div className="text-sm text-slate-400">Click when zoomed</div>
          </div>
        </div>
      ),
    },
    {
      id: "session-key",
      title: "Create Session Key",
      description: "Session keys let you paint without approving every transaction. Create one and fund it with 0.01 SOL.",
      content: (
        <div className="space-y-4">
          {/* Step 1: Create Session Key */}
          <div className={`rounded-lg p-4 border transition-all ${
            sessionCreated 
              ? 'bg-emerald-50 border-emerald-200' 
              : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-slate-700">1. Create key</span>
              {sessionCreated && <span className="text-emerald-500"><CheckIcon /></span>}
            </div>
            <p className="text-sm text-slate-400 mb-3">
              Sign a message to generate your session key.
            </p>
            <button
              onClick={handleCreateSessionKey}
              disabled={isLoading || sessionCreated}
              className={`w-full py-2.5 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                sessionCreated
                  ? 'bg-emerald-100 text-emerald-700 cursor-default'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {isLoading && !sessionCreated ? (
                <>
                  <LoadingSpinner />
                  <span>Creating...</span>
                </>
              ) : sessionCreated ? (
                <>
                  <CheckIcon />
                  <span>Created</span>
                </>
              ) : (
                'Create Session Key'
              )}
            </button>
            {sessionKey.publicKey && (
              <div className="mt-2 text-xs text-slate-400 font-mono truncate">
                {sessionKey.publicKey.toBase58().slice(0, 24)}...
              </div>
            )}
          </div>

          {/* Step 2: Top Up */}
          <div className={`rounded-lg p-4 border transition-all ${
            !sessionCreated 
              ? 'bg-slate-50 border-slate-100 opacity-50' 
              : topUpComplete
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-slate-700">2. Fund with 0.01 SOL</span>
              {topUpComplete && <span className="text-emerald-500"><CheckIcon /></span>}
            </div>
            <p className="text-sm text-slate-400 mb-3">
              Add SOL to cover transaction fees.
            </p>
            <button
              onClick={handleTopUpSessionKey}
              disabled={isLoading || !sessionCreated || topUpComplete}
              className={`w-full py-2.5 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                topUpComplete
                  ? 'bg-emerald-100 text-emerald-700 cursor-default'
                  : !sessionCreated
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {isLoading && sessionCreated && !topUpComplete ? (
                <>
                  <LoadingSpinner />
                  <span>Sending...</span>
                </>
              ) : topUpComplete ? (
                <>
                  <CheckIcon />
                  <span>Funded</span>
                </>
              ) : (
                'Send 0.01 SOL'
              )}
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "place-pixels",
      title: "Place Pixels",
      description: "Select a color from the palette at the bottom, then click anywhere on the canvas to paint.",
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center font-medium">1</span>
            <span>Select a color from the palette</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center font-medium">2</span>
            <span>Zoom in until you see individual pixels</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center font-medium">3</span>
            <span>Click to paint instantly</span>
          </div>
          
          {/* Sample palette preview */}
          <div className="pt-2">
            <div className="grid grid-cols-8 gap-1">
              {['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
                '#808080', '#c0c0c0', '#800000', '#008000', '#000080', '#808000', '#800080', '#008080'].map((color) => (
                <div
                  key={color}
                  className="w-full aspect-square rounded shadow-sm border border-slate-200"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "ready",
      title: "You're Ready",
      description: "Start creating on the world's largest on-chain canvas. Your pixels are stored permanently on Solana.",
      content: (
        <div className="text-center py-4">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-sm">On-chain</span>
            <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-sm">Collaborative</span>
            <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-sm">Permanent</span>
          </div>
        </div>
      ),
    },
  ];

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  // Safety check
  if (!currentStepData) {
    return null;
  }

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const handleStartWalkthrough = () => {
    setShowWalkthrough(true);
    setCurrentStep(1);
  };

  // Welcome screen
  if (!showWalkthrough) {
    return (
      <div className="absolute inset-0 w-screen h-screen bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
          {/* Header */}
          <div className="bg-slate-50 p-8 text-center border-b border-slate-100">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="7" height="7" x="3" y="3" rx="1"/>
                <rect width="7" height="7" x="14" y="3" rx="1"/>
                <rect width="7" height="7" x="14" y="14" rx="1"/>
                <rect width="7" height="7" x="3" y="14" rx="1"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-800">
              Welcome to Magicplace
            </h1>
          </div>

          {/* Content */}
          <div className="p-6">
            <p className="text-slate-500 text-center mb-6">
              A quick tour to help you get started with painting on the canvas.
            </p>

            <button
              onClick={handleStartWalkthrough}
              className="w-full py-3 px-6 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl shadow-lg transition-all mb-3"
            >
              Start Walkthrough
            </button>

            <button
              onClick={onSkip}
              className="w-full text-slate-400 hover:text-slate-600 text-sm py-2 transition-colors"
            >
              Skip, I know what I'm doing
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Walkthrough steps
  return (
    <div className="absolute inset-0 w-screen h-screen bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Progress */}
        <div className="px-6 pt-5">
          <div className="flex items-center gap-1.5">
            {steps.slice(1).map((step, index) => (
              <div
                key={step.id}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  index < currentStep - 1
                    ? 'bg-blue-500'
                    : index === currentStep - 1
                      ? 'bg-blue-500'
                      : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
          <div className="text-xs text-slate-400 mt-2">
            Step {currentStep} of {steps.length - 1}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            {currentStepData.title}
          </h2>
          <p className="text-slate-500 text-sm mb-6">
            {currentStepData.description}
          </p>

          {/* Step content */}
          <div className="min-h-[180px]">
            {currentStepData.content}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between">
          <button
            onClick={handleBack}
            disabled={currentStep <= 1}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              currentStep <= 1
                ? 'text-slate-300 cursor-not-allowed'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
            }`}
          >
            Back
          </button>

          <button
            onClick={handleNext}
            className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl shadow transition-all"
          >
            {isLastStep ? "Get Started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
