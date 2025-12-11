import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { WalletName } from '@solana/wallet-adapter-base';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useSessionKey } from '@/hooks/use-session-key';
import { useSessionBalance } from './session-balance-provider';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Wallet icons
const WalletIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
);

const DisconnectIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
);

const CopyIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
);

const CheckIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const ChevronDownIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

interface WalletItemProps {
    name: string;
    icon: string;
    readyState: WalletReadyState;
    onClick: () => void;
    isConnecting: boolean;
}

function WalletItem({ name, icon, readyState, onClick, isConnecting }: WalletItemProps) {
    const isInstalled = readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable;
    
    return (
        <button
            onClick={onClick}
            disabled={isConnecting}
            className={cn(
                "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200",
                "border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "group"
            )}
        >
            <div className="w-10 h-10 rounded-lg bg-white shadow-sm border border-slate-100 flex items-center justify-center overflow-hidden p-1.5">
                <img src={icon} alt={name} className="w-full h-full object-contain" />
            </div>
            <div className="flex-1 text-left">
                <div className="font-medium text-slate-800 group-hover:text-blue-600 transition-colors">
                    {name}
                </div>
                <div className="text-xs text-slate-400">
                    {isInstalled ? 'Detected' : 'Not installed'}
                </div>
            </div>
            {isConnecting && (
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
            {!isConnecting && isInstalled && (
                <div className="text-slate-400 group-hover:text-blue-500 transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </div>
            )}
        </button>
    );
}

interface WalletConnectProps {
    onMenuOpenChange?: (isOpen: boolean) => void;
}

export function WalletConnect({ onMenuOpenChange }: WalletConnectProps) {
    const { wallets, select, disconnect, connecting, connected, publicKey, wallet } = useWallet();
    const { connection } = useConnection();
    const { sessionKey } = useSessionKey();
    const { balance: sessionBalance, topup } = useSessionBalance();

    const [isOpen, setIsOpen] = useState(false);
    const [showAccountMenu, setShowAccountMenu] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedSession, setCopiedSession] = useState(false);
    const [isToppingUp, setIsToppingUp] = useState(false);
    const [topupAmount, setTopupAmount] = useState('0.05');

    // Top up session key with custom amount
    const handleTopUpSession = useCallback(async (amount?: number) => {
        if (!sessionKey.publicKey || !publicKey) return;

        const topupSol = amount ?? (parseFloat(topupAmount) || 0.01);
        if (topupSol <= 0 || topupSol > 10) {
            console.error("Invalid top-up amount");
            return;
        }

        setIsToppingUp(true);
        try {
            await topup(topupSol);
        } catch (error) {
            console.error("Top up failed:", error);
        } finally {
            setIsToppingUp(false);
        }
    }, [sessionKey.publicKey, publicKey, topup, topupAmount]);

    // Copy session key address
    const handleCopySessionAddress = useCallback(() => {
        if (sessionKey.publicKey) {
            navigator.clipboard.writeText(sessionKey.publicKey.toBase58());
            setCopiedSession(true);
            setTimeout(() => setCopiedSession(false), 2000);
        }
    }, [sessionKey.publicKey]);

    // Notify parent when account menu opens/closes
    useEffect(() => {
        onMenuOpenChange?.(showAccountMenu);
    }, [showAccountMenu, onMenuOpenChange]);

    // Close dialog when connected
    useEffect(() => {
        if (connected) {
            setIsOpen(false);
        }
    }, [connected]);

    const handleSelectWallet = useCallback(async (walletName: WalletName) => {
        try {
            select(walletName);
        } catch (error) {
            console.error('Failed to select wallet:', error);
        }
    }, [select]);

    const handleCopyAddress = useCallback(() => {
        if (publicKey) {
            navigator.clipboard.writeText(publicKey.toBase58());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [publicKey]);

    const handleDisconnect = useCallback(() => {
        disconnect();
        setShowAccountMenu(false);
    }, [disconnect]);

    const truncateAddress = (address: string) => {
        return `${address.slice(0, 4)}...${address.slice(-4)}`;
    };

    // Separate installed and not installed wallets
    const installedWallets = wallets.filter(
        w => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable
    );
    const otherWallets = wallets.filter(
        w => w.readyState !== WalletReadyState.Installed && w.readyState !== WalletReadyState.Loadable
    );

    // Connected state - show account button with dropdown
    if (connected && publicKey) {
        return (
            <div className="flex items-center gap-3">
                {/* Session Key Info */}
                {sessionKey.publicKey && (
                    <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-white/95 backdrop-blur-sm shadow-lg border border-slate-200">
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Session</span>
                        <span className="font-mono text-sm text-slate-700">
                            {sessionBalance !== null ? `${sessionBalance.toFixed(3)} SOL` : '...'}
                        </span>
                        <button
                            onClick={() => handleTopUpSession(0.01)}
                            disabled={isToppingUp}
                            className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition-colors disabled:opacity-50"
                            title="Top up session key (0.01 SOL)"
                        >
                            {isToppingUp ? (
                                <div className="w-3 h-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"/>
                                    <line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                            )}
                        </button>
                    </div>
                )}
                
                <div className="relative">
                    <button
                        onClick={() => setShowAccountMenu(!showAccountMenu)}
                        className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-xl",
                            "bg-white/95 backdrop-blur-sm shadow-lg",
                            "border border-slate-200 hover:border-slate-300",
                            "transition-all duration-200"
                        )}
                    >
                        {wallet?.adapter.icon && (
                            <img 
                                src={wallet.adapter.icon} 
                                alt={wallet.adapter.name} 
                                className="w-5 h-5 rounded"
                            />
                        )}
                        <span className="font-mono text-sm text-slate-700">
                            {truncateAddress(publicKey.toBase58())}
                        </span>
                        <ChevronDownIcon />
                    </button>

                    {/* Dropdown menu */}
                    {showAccountMenu && (
                        <>
                            {/* Backdrop */}
                            <div 
                                className="fixed inset-0 z-40" 
                                onClick={() => setShowAccountMenu(false)} 
                            />
                            
                            {/* Menu */}
                            <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-100 animate-in fade-in slide-in-from-top-2 duration-200">
                                {/* Account header */}
                                <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                                    <div className="flex items-center gap-3">
                                        {wallet?.adapter.icon && (
                                            <img 
                                                src={wallet.adapter.icon} 
                                                alt={wallet.adapter.name} 
                                                className="w-8 h-8 rounded-lg"
                                            />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-slate-700">
                                                {wallet?.adapter.name}
                                            </div>
                                            <div className="text-xs text-slate-400 truncate">
                                                Connected
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Session Key Details in Menu (for mobile/full view) */}
                                {sessionKey.publicKey && (
                                    <div className="p-3 border-b border-slate-100 bg-emerald-50/30">
                                        <div className="text-xs font-semibold text-emerald-700 mb-2 uppercase tracking-wider">
                                            Session Key Active
                                        </div>
                                        
                                        {/* Session key address with copy */}
                                        <button
                                            onClick={handleCopySessionAddress}
                                            className="w-full flex items-center gap-2 px-2 py-1.5 mb-2 rounded-lg bg-white/70 hover:bg-white transition-colors text-left"
                                        >
                                            <span className="flex-1 font-mono text-xs text-slate-500 truncate">
                                                {sessionKey.publicKey.toBase58()}
                                            </span>
                                            {copiedSession ? (
                                                <CheckIcon />
                                            ) : (
                                                <CopyIcon />
                                            )}
                                        </button>
                                        
                                        {/* Balance */}
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-xs text-slate-500">Balance</span>
                                            <span className="font-medium text-sm text-slate-700">
                                                {sessionBalance !== null ? `${sessionBalance.toFixed(4)} SOL` : '...'}
                                            </span>
                                        </div>
                                        
                                        {/* Custom topup amount */}
                                        <div className="flex gap-2">
                                            <div className="flex-1 relative">
                                                <input
                                                    type="number"
                                                    value={topupAmount}
                                                    onChange={(e) => setTopupAmount(e.target.value)}
                                                    min="0.001"
                                                    max="10"
                                                    step="0.01"
                                                    className="w-full py-1.5 px-3 pr-12 text-sm border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400"
                                                    placeholder="0.05"
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                                                    SOL
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => handleTopUpSession()}
                                                disabled={isToppingUp || !topupAmount || parseFloat(topupAmount) <= 0}
                                                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white text-xs font-medium rounded shadow-sm hover:shadow transition-all disabled:cursor-not-allowed"
                                            >
                                                {isToppingUp ? '...' : 'Top Up'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                
                                {/* Address section */}
                                <div className="p-3 border-b border-slate-100">
                                    <button
                                        onClick={handleCopyAddress}
                                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors text-left"
                                    >
                                        <span className="flex-1 font-mono text-sm text-slate-600 truncate">
                                            {publicKey.toBase58()}
                                        </span>
                                        {copied ? (
                                            <CheckIcon />
                                        ) : (
                                            <CopyIcon />
                                        )}
                                    </button>
                                </div>

                                {/* Actions */}
                                <div className="p-2">
                                    <button
                                        onClick={handleDisconnect}
                                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                                    >
                                        <DisconnectIcon />
                                        <span className="text-sm font-medium">Disconnect</span>
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    }

    // Disconnected state - show connect button with dialog
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button 
                    variant="default" 
                    className="bg-blue-500 hover:bg-blue-600 text-white gap-2 shadow-lg rounded-xl"
                >
                    <WalletIcon />
                    <span>Connect Wallet</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-white rounded-2xl">
                <DialogHeader className="px-6 pt-6 pb-2">
                    <DialogTitle className="text-xl font-semibold text-slate-800">
                        Connect Wallet
                    </DialogTitle>
                    <DialogDescription className="text-slate-500">
                        Select a wallet to connect to MagicPlace
                    </DialogDescription>
                </DialogHeader>
                
                <div className="px-6 pb-6 space-y-4">
                    {/* Installed wallets */}
                    {installedWallets.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider px-1">
                                Available
                            </div>
                            <div className="space-y-2">
                                {installedWallets.map((w) => (
                                    <WalletItem
                                        key={w.adapter.name}
                                        name={w.adapter.name}
                                        icon={w.adapter.icon}
                                        readyState={w.readyState}
                                        onClick={() => handleSelectWallet(w.adapter.name as WalletName)}
                                        isConnecting={connecting && wallet?.adapter.name === w.adapter.name}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Other wallets */}
                    {otherWallets.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider px-1">
                                {installedWallets.length > 0 ? 'More options' : 'Available wallets'}
                            </div>
                            <div className="space-y-2 opacity-60">
                                {otherWallets.slice(0, 5).map((w) => (
                                    <WalletItem
                                        key={w.adapter.name}
                                        name={w.adapter.name}
                                        icon={w.adapter.icon}
                                        readyState={w.readyState}
                                        onClick={() => handleSelectWallet(w.adapter.name as WalletName)}
                                        isConnecting={connecting && wallet?.adapter.name === w.adapter.name}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* No wallets found */}
                    {wallets.length === 0 && (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                                <WalletIcon />
                            </div>
                            <div className="text-slate-700 font-medium mb-1">No wallets found</div>
                            <div className="text-sm text-slate-400">
                                Install a Solana wallet extension to continue
                            </div>
                        </div>
                    )}

                    {/* Footer */}
                    <div className="pt-4 border-t border-slate-100">
                        <p className="text-xs text-center text-slate-400">
                            New to Solana?{' '}
                            <a 
                                href="https://phantom.app/" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:underline"
                            >
                                Get Phantom
                            </a>
                        </p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default WalletConnect;
