import { useState, useEffect, createContext, useContext } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSessionKey } from "@/hooks/use-session-key";
import { useMagicplaceProgram } from "@/hooks/use-magicplace-program";
import OnboardingWalkthrough from "./onboarding-walkthrough";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

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
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="7" x="3" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="14" rx="1"/>
    <rect width="7" height="7" x="3" y="14" rx="1"/>
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
  const { select, wallets, connect, connecting } = useWallet();
  const [showWalletList, setShowWalletList] = useState(false);

  const handleConnectClick = () => {
    setShowWalletList(true);
  };

  // Find installed wallets
  const installedWallets = wallets.filter(
    w => w.readyState === 'Installed' || w.readyState === 'Loadable'
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-white/20 flex items-center justify-center">
            <PixelIcon />
          </div>
          <h1 className="text-2xl font-bold text-white">
            Welcome to Magicplace
          </h1>
          <p className="text-blue-100 mt-2 text-sm">
            The collaborative pixel canvas on Solana
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {!showWalletList ? (
            <>
              <div className="space-y-3 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                    🎨
                  </div>
                  <div>
                    <div className="font-medium text-slate-700">Create pixel art together</div>
                    <div className="text-sm text-slate-500">Collaborate with others on a shared canvas</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
                    ⛓️
                  </div>
                  <div>
                    <div className="font-medium text-slate-700">Stored on-chain forever</div>
                    <div className="text-sm text-slate-500">Every pixel is permanently saved on Solana</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 flex-shrink-0">
                    ⚡
                  </div>
                  <div>
                    <div className="font-medium text-slate-700">Fast & affordable</div>
                    <div className="text-sm text-slate-500">Powered by Ephemeral Rollups for instant updates</div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleConnectClick}
                className="w-full py-3 px-6 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 mb-3"
              >
                <WalletIcon />
                Connect Wallet
              </button>

              <button
                onClick={onBrowse}
                className="w-full py-3 px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-all flex items-center justify-center gap-2"
              >
                <EyeIcon />
                I'll just look around
              </button>
            </>
          ) : (
            <>
              <p className="text-slate-600 text-center mb-4">
                Select a wallet to connect
              </p>
              <div className="space-y-2 mb-4">
                {installedWallets.map((wallet) => (
                  <button
                    key={wallet.adapter.name}
                    onClick={() => {
                      select(wallet.adapter.name);
                      onConnect();
                    }}
                    disabled={connecting}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all"
                  >
                    <img 
                      src={wallet.adapter.icon} 
                      alt={wallet.adapter.name} 
                      className="w-8 h-8 rounded-lg"
                    />
                    <span className="font-medium text-slate-700">{wallet.adapter.name}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowWalletList(false)}
                className="w-full text-slate-500 hover:text-slate-700 text-sm py-2"
              >
                ← Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * StartUsing - Gatekeeper component for onboarding flow
 * 
 * States:
 * 1. Not connected + first visit → Welcome popup
 * 2. Not connected + browsing → Readonly mode (no popup)
 * 3. Connected + no session → Onboarding
 * 4. Connected + session active → Full access
 */
export default function StartUsing({ children }: { children: React.ReactNode }) {
  const { connected, connecting } = useWallet();
  const { isActive, publicKey: sessionPublicKey, revokeSession } = useSessionKey();
  const { fetchSessionAccount, program } = useMagicplaceProgram();
  
  // State management
  const [showWelcome, setShowWelcome] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isReadonly, setIsReadonly] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Check initial state on mount
  useEffect(() => {
    if (!connected && !connecting) {
      // Not connected - show welcome
      setShowWelcome(true);
    }
    setInitialized(true);
  }, []);

  // Handle wallet connection
  useEffect(() => {
    if (connected && !isActive && initialized) {
      // Just connected, need session key
      setShowWelcome(false);
      setIsReadonly(false);
      setShowOnboarding(true);
    }
  }, [connected, isActive, initialized]);

  // Verify session on-chain existence
  useEffect(() => {
    const validateSession = async () => {
        if (connected && isActive && sessionPublicKey && program) {
            // Check if session exists on chain
             // No need for timeout if we check program existence
            const session = await fetchSessionAccount(sessionPublicKey);
            if (!session) {
                console.log("Session key exists locally but not on-chain. Revoking to force re-initialization.");
                revokeSession();
            }
        }
    };
    
    validateSession();
  }, [connected, isActive, sessionPublicKey, fetchSessionAccount, revokeSession, program]);

  // Handle connect from welcome
  const handleConnect = () => {
    setShowWelcome(false);
    // Wallet adapter will handle connection, useEffect above will trigger onboarding
  };

  // Handle browse mode
  const handleBrowse = () => {
    setShowWelcome(false);
    setIsReadonly(true);
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
      
      {/* Welcome popup for disconnected users */}
      {showWelcome && !connected && (
        <WelcomePopup onConnect={handleConnect} onBrowse={handleBrowse} />
      )}

      {/* Onboarding for connected users without session */}
      {showOnboarding && connected && !isActive && (
        <OnboardingWalkthrough onComplete={handleOnboardingComplete} />
      )}
    </ReadonlyModeContext.Provider>
  );
}