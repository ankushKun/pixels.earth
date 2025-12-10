import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import OnboardingWalkthrough from "./onboarding-walkthrough";

const ONBOARDING_COMPLETE_KEY = "magicplace_onboarding_complete";

export default function StartUsing() {
  const wallet = useWallet();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isCheckingStorage, setIsCheckingStorage] = useState(true);

  useEffect(() => {
    // Check if user has completed onboarding before
    const completed = localStorage.getItem(ONBOARDING_COMPLETE_KEY);
    if (!completed && wallet.connected) {
      setShowOnboarding(true);
    }
    setIsCheckingStorage(false);
  }, [wallet.connected]);

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
    setShowOnboarding(false);
  };

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
    setShowOnboarding(false);
  };

  // Don't render anything until we've checked storage
  if (isCheckingStorage) {
    return null;
  }

  // Show onboarding if user hasn't completed it
  if (showOnboarding) {
    return (
      <OnboardingWalkthrough
        onComplete={handleComplete}
        onSkip={handleSkip}
      />
    );
  }

  return null;
}