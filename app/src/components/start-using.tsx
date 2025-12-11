import { useState, useEffect, createContext, useContext } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSessionKey } from "@/hooks/use-session-key";
import { useMagicplaceProgram } from "@/hooks/use-magicplace-program";
import { getNickname, setNickname } from "@/hooks/use-gun-presence";
import OnboardingWalkthrough from "./onboarding-walkthrough";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PenTool } from "lucide-react";

// ============================================================================
// Readonly Mode Context
// ============================================================================

interface ReadonlyModeContextType {
  isReadonly: boolean;
}

const ReadonlyModeContext = createContext<ReadonlyModeContextType>({ isReadonly: false });

export function useReadonlyMode() {
  return useContext(ReadonlyModeContext);
}

// ============================================================================
// Icons
// ============================================================================

const PixelIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-900">
    <rect width="18" height="18" x="3" y="3" rx="2" strokeWidth="1.5"/>
    <path d="M3 9h18"/>
    <path d="M9 21V9"/>
    <path d="M3 15h6"/>
    <path d="M15 9v12"/>
  </svg>
);

const EyeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const WalletIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>
    <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>
  </svg>
);

// ============================================================================
// Welcome Popup Component
// ============================================================================

interface WelcomePopupProps {
  onConnect: () => void;
  onBrowse: () => void;
}

function WelcomePopup({ onConnect, onBrowse }: WelcomePopupProps) {
  const { select, wallets, connecting, connected } = useWallet();
  const [showWalletList, setShowWalletList] = useState(false);
  const [nickname, setNicknameInput] = useState(getNickname() || "");

  // When wallet connects, trigger onConnect callback
  useEffect(() => {
    if (connected && showWalletList) {
      onConnect();
    }
  }, [connected, showWalletList, onConnect]);

  const handleConnectClick = () => {
    setShowWalletList(true);
  };

  const handleEnter = () => {
    // Save nickname before entering
    setNickname(nickname.trim() || null);
    onBrowse();
  };

  // Find installed wallets
  const installedWallets = wallets.filter(
    w => w.readyState === 'Installed' || w.readyState === 'Loadable'
  );

  return (
    <div className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-100 flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-[2.5rem] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.2)] max-w-[24rem] w-full overflow-hidden border border-zinc-100 p-8 transform transition-all duration-300 ease-in-out">
        
        {/* Header Content */}
        {!showWalletList && (
           <div className="flex flex-col items-center text-center">
            {connected ? (
                 <>
                    <div className="w-20 h-20 bg-emerald-200/50 rounded-full flex items-center justify-center mb-6 text-4xl shadow-inner text-emerald-500">
                      <img src="/icon.png" alt="" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome to pixels.earth!</h1>
                    <p className="text-slate-500 text-sm leading-relaxed mb-6 max-w-[20rem]">
                        You're all set to start creating on the infinite canvas.
                    </p>
                    
                    {/* Nickname Input */}
                    <div className="w-full mb-6 text-left">
                      <label htmlFor="welcome-nickname" className="block text-sm font-bold text-slate-700 mb-2">
                        Nickname <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        id="welcome-nickname"
                        value={nickname}
                        onChange={(e) => setNicknameInput(e.target.value)}
                        placeholder="Enter a display name..."
                        maxLength={20}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                      />
                      <p className="mt-1 text-xs text-slate-400">Shown to others on the map</p>
                    </div>

                    <button
                        onClick={handleEnter}
                        className="w-full py-4 bg-slate-900 hover:bg-black text-white font-bold rounded-full shadow-[0_4px_14px_0_rgba(0,0,0,0.39)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.23)] hover:-translate-y-0.5 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        Enter pixels.earth
                    </button>
                 </>
            ) : (
                <>
                    <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6 shadow-sm relative group">
                        <div className="absolute inset-0 rounded-full border border-indigo-100 animate-ping opacity-20 duration-[3s]"></div>
                        <PixelIcon />
                    </div>
                    
                    <h1 className="text-[1.75rem] font-extrabold text-slate-900 mb-2 tracking-tight">
                        pixels.earth
                    </h1>
                    <p className="text-slate-500 text-[0.95rem] leading-relaxed mb-8 font-medium">
                        Collaborate on an infinite pixel canvas. <br/>
                        Built on Solana & Magicblock.
                    </p>

                    <div className="w-full space-y-3">
                        <button
                            onClick={handleConnectClick}
                            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-full shadow-[0_4px_14px_0_rgba(99,102,241,0.39)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.23)] hover:-translate-y-0.5 transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                            <WalletIcon />
                            Connect Wallet
                        </button>

                        <button
                            onClick={onBrowse}
                            className="w-full py-4 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold rounded-full transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                            <EyeIcon />
                            Just explore for now
                        </button>
                    </div>
                </>
            )}
           </div>
        )}

        {/* Wallet List View */}
        {showWalletList && (
            <div className="flex flex-col h-full animate-in slide-in-from-right-8 fade-in duration-300">
                <div className="flex items-center justify-between mb-6">
                    <button 
                        onClick={() => setShowWalletList(false)}
                        className="p-2 -ml-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 18l-6-6 6-6"/>
                        </svg>
                    </button>
                    <h2 className="text-lg font-bold text-slate-900">
                        {connecting ? "Connecting..." : "Select Wallet"}
                    </h2>
                    <div className="w-8" /> {/* Spacer for centering */}
                </div>

                {connecting ? (
                    <div className="flex flex-col items-center justify-center py-8">
                        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                        <p className="text-slate-500 font-medium">Waiting for wallet...</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {installedWallets.map((wallet) => (
                        <button
                            key={wallet.adapter.name}
                            onClick={() => {
                                select(wallet.adapter.name);
                            }}
                            disabled={connecting}
                            className="w-full flex items-center gap-4 p-4 rounded-3xl border-2 border-slate-50 bg-white hover:border-indigo-100 hover:bg-indigo-50/30 transition-all group active:scale-[0.98]"
                        >
                            <img 
                                src={wallet.adapter.icon} 
                                alt={wallet.adapter.name} 
                                className="w-10 h-10 rounded-xl shadow-sm group-hover:scale-110 transition-transform"
                            />
                            <span className="font-bold text-slate-700 group-hover:text-indigo-900 text-lg">{wallet.adapter.name}</span>
                        </button>
                        ))}
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

const Transition = ({ show, children, className = "" }: { show: boolean; children: React.ReactNode; className?: string }) => {
    const [shouldRender, setShouldRender] = useState(show);
    const [styles, setStyles] = useState("opacity-0 scale-95 pointer-events-none");

    useEffect(() => {
        if (show) {
            setShouldRender(true);
            // Small timeout to ensure DOM is present before animating in
            const t = setTimeout(() => {
                setStyles("opacity-100 scale-100");
            }, 10);
            return () => clearTimeout(t);
        } else {
            setStyles("opacity-0 scale-95 pointer-events-none");
            const t = setTimeout(() => {
                setShouldRender(false);
            }, 300); // Match transition duration
            return () => clearTimeout(t);
        }
    }, [show]);

    if (!shouldRender) return null;

    return (
        <div className={`fixed inset-0 z-100 transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${styles} ${className}`}>
             {/* We use a relative container to ensure children with absolute/fixed positioning are contained if needed,
                 though 'fixed' children in a transformed parent work relatively. */}
            {children}
        </div>
    );
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * StartUsing - Gatekeeper component for onboarding flow
 */
export default function StartUsing({ children }: { children: React.ReactNode }) {
  const { connected, connecting } = useWallet();
  const { isActive, publicKey: sessionPublicKey, revokeSession } = useSessionKey();
  const { fetchSessionAccount, program } = useMagicplaceProgram();
  
  // State management
  const [showWelcome, setShowWelcome] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isReadonly, setIsReadonly] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Check initial state on mount
  useEffect(() => {
    setInitialized(true);
  }, []);

  // Handle wallet connection & Transition logic
  useEffect(() => {
    if (!initialized) return;

    if (connected) {
        // Just ensure we are not in readonly mode if connected
        setIsReadonly(false);
    } else {
        // If disconnected, ensure onboarding is hidden
        setShowOnboarding(false);
    }
  }, [connected, isActive, initialized]);

  // Verify session on-chain existence
  useEffect(() => {
    const validateSession = async () => {
        if (connected && isActive && sessionPublicKey && program) {
            const session = await fetchSessionAccount(sessionPublicKey);
            if (!session) {
                console.log("Session key exists locally but not on-chain. Revoking to force re-initialization.");
                revokeSession();
            }
        }
    };
    
    validateSession();
  }, [connected, isActive, sessionPublicKey, fetchSessionAccount, revokeSession, program]);

  // Handle connect from welcome - wallet is now connected
  const handleConnect = () => {
    setShowWelcome(false);
    setIsReadonly(false);
    // Start onboarding after a short delay
    setTimeout(() => setShowOnboarding(true), 300);
  };

  // Handle browse mode or continue
  const handleBrowse = () => {
    setShowWelcome(false);
    if (!connected) {
        setIsReadonly(true);
    } else {
        setIsReadonly(false);
        // If connected but no session, start onboarding now
        if (!isActive) {
            setTimeout(() => setShowOnboarding(true), 300);
        }
    }
  };

  // Handle onboarding complete
  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  // Don't render until initialized
  if (!initialized) {
    return null;
  }

  return (
    <ReadonlyModeContext.Provider value={{ isReadonly }}>
      {children}
      
      {/* Welcome popup */}
      <Transition show={showWelcome}>
        <WelcomePopup onConnect={handleConnect} onBrowse={handleBrowse} />
      </Transition>

      {/* Onboarding for connected users without session */}
      <Transition show={showOnboarding && connected && !isActive}>
        <OnboardingWalkthrough onComplete={handleOnboardingComplete} />
      </Transition>
    </ReadonlyModeContext.Provider>
  );
}