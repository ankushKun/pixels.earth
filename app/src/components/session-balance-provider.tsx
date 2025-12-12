import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useSessionKey } from '@/hooks/use-session-key';
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

interface TopupRequest {
  amountNeeded: number; // in SOL
  reason: string;
  onSuccess?: () => void;
}

interface SessionBalanceContextType {
  balance: number | null;
  refreshBalance: () => Promise<void>;
  checkBalance: (amountNeeded: number, reason?: string, onSuccess?: () => void) => Promise<boolean>;
  requestTopup: (amountNeeded: number, reason?: string) => void;
  topup: (amount: number) => Promise<void>;
  topupRequest: TopupRequest | null;
  clearTopupRequest: () => void;
}

// ============================================================================
// Context
// ============================================================================

const SessionBalanceContext = createContext<SessionBalanceContextType>({
  balance: null,
  refreshBalance: async () => { },
  checkBalance: async () => true,
  requestTopup: () => { },
  topup: async () => { },
  topupRequest: null,
  clearTopupRequest: () => { },
});

export function useSessionBalance() {
  return useContext(SessionBalanceContext);
}

// ============================================================================
// Icons
// ============================================================================

const WalletIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
    <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
  </svg>
);

const AlertIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

// ============================================================================
// Low Balance Popup
// ============================================================================

interface LowBalancePopupProps {
  amountNeeded: number;
  reason: string;
  currentBalance: number;
  onTopup: (amount: number) => Promise<void>;
  onClose: () => void;
}

function LowBalancePopup({ amountNeeded, reason, currentBalance, onTopup, onClose }: LowBalancePopupProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggest a nice round number that covers the needed amount
  const suggestedTopup = Math.max(0.01, Math.ceil((amountNeeded - currentBalance + 0.005) * 100) / 100);

  const handleTopup = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onTopup(suggestedTopup);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Top-up failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-200 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
        {/* Header */}
        <div className="bg-amber-50 p-6 text-center border-b border-amber-100">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
            <AlertIcon />
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            Low Session Balance
          </h2>
          <p className="text-slate-600 text-sm mt-1">
            {reason || 'Not enough SOL in session key'}
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Balance Info */}
          <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Current balance</span>
              <span className="font-mono text-slate-700">{currentBalance.toFixed(4)} SOL</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Amount needed</span>
              <span className="font-mono text-red-600">{amountNeeded.toFixed(4)} SOL</span>
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between text-sm font-medium">
              <span className="text-slate-700">Suggested top-up</span>
              <span className="font-mono text-emerald-600">{suggestedTopup.toFixed(3)} SOL</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={handleTopup}
              disabled={isLoading}
              className="w-full py-3 px-6 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white font-semibold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <WalletIcon />
                  Top up {suggestedTopup.toFixed(3)} SOL
                </>
              )}
            </button>

            <button
              onClick={onClose}
              disabled={isLoading}
              className="w-full py-2 text-slate-500 hover:text-slate-700 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      <div className="text-center pt-2">
        <a
          href="https://faucet.solana.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-400 hover:text-slate-600 underline decoration-slate-300 underline-offset-2"
        >
          Need devnet SOL? Use Faucet
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Provider
// ============================================================================

export function SessionBalanceProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { sessionKey } = useSessionKey();

  const [balance, setBalance] = useState<number | null>(null);
  const [topupRequest, setTopupRequest] = useState<TopupRequest | null>(null);

  // Refresh session key balance
  const refreshBalance = useCallback(async () => {
    if (!sessionKey.publicKey) {
      setBalance(null);
      return;
    }
    try {
      const lamports = await connection.getBalance(sessionKey.publicKey);
      setBalance(lamports / LAMPORTS_PER_SOL);
    } catch (e) {
      console.error('Failed to fetch session balance:', e);
    }
  }, [connection, sessionKey.publicKey]);

  // Auto-refresh on mount and session key change
  useEffect(() => {
    refreshBalance();
    // Refresh every 30 seconds
    const interval = setInterval(refreshBalance, 30000);
    return () => clearInterval(interval);
  }, [refreshBalance]);

  // Check if balance is sufficient
  const checkBalance = useCallback(async (amountNeeded: number, reason?: string, onSuccess?: () => void): Promise<boolean> => {
    // Fetch fresh balance directly instead of relying on state
    let currentBalance = balance;
    if (sessionKey.publicKey) {
      try {
        const lamports = await connection.getBalance(sessionKey.publicKey);
        currentBalance = lamports / LAMPORTS_PER_SOL;
        setBalance(currentBalance);
      } catch (e) {
        console.error('Failed to fetch session balance:', e);
      }
    }

    if (currentBalance === null || currentBalance < amountNeeded) {
      setTopupRequest({
        amountNeeded,
        reason: reason || `Need ${amountNeeded.toFixed(4)} SOL for this action`,
        onSuccess,
      });
      return false;
    }
    return true;
  }, [connection, sessionKey.publicKey, balance]);

  // Request topup manually
  const requestTopup = useCallback((amountNeeded: number, reason?: string) => {
    setTopupRequest({
      amountNeeded,
      reason: reason || `Top up session key`,
    });
  }, []);

  // Handle topup
  const handleTopup = useCallback(async (amount: number) => {
    if (!wallet.publicKey || !wallet.signTransaction || !sessionKey.publicKey) {
      toast.error('Wallet or session key not available');
      throw new Error('Wallet or session key not available');
    }

    const toastId = toast.loading(`Initiating top-up of ${amount} SOL...`);

    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: sessionKey.publicKey,
          lamports: Math.round(amount * LAMPORTS_PER_SOL),
        })
      );

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const signedTx = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signedTx.serialize());

      toast.loading("Confirming top-up transaction...", { id: toastId });
      await connection.confirmTransaction(sig, 'confirmed');

      // Customize success message based on pending action
      let successMessage = `Successfully topped up ${amount} SOL!`;
      if (topupRequest?.reason && !topupRequest.reason.startsWith("Need")) {
        // Convert "Unlock shard..." to "You can now unlock shard..."
        const action = topupRequest.reason.charAt(0).toLowerCase() + topupRequest.reason.slice(1);
        successMessage = `Top-up complete! You can now ${action}.`;
      }

      toast.success(successMessage, { id: toastId });

      // Refresh balance after topup
      await refreshBalance();

      // Trigger onSuccess callback if present
      if (topupRequest?.onSuccess) {
        topupRequest.onSuccess();
      }
    } catch (e) {
      console.error('Top-up failed:', e);
      toast.error("Top-up failed: " + (e instanceof Error ? e.message : String(e)), { id: toastId });
      throw e;
    }
  }, [wallet, sessionKey.publicKey, connection, refreshBalance, topupRequest]);

  // Clear topup request
  const clearTopupRequest = useCallback(() => {
    setTopupRequest(null);
  }, []);

  return (
    <SessionBalanceContext.Provider value={{ 
      balance, 
      refreshBalance, 
      checkBalance, 
      requestTopup, 
      topup: handleTopup,
      topupRequest,
      clearTopupRequest
    }}>
      {children}
    </SessionBalanceContext.Provider>
  );
}
