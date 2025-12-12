import { PixelCanvas } from "./components/pixel-canvas";
import { Toaster } from "sonner";
import "./index.css";
import { SessionBalanceProvider } from "./components/session-balance-provider";
import Tour from "./components/tour";
import { useEffect, useRef, useState } from "react";
import { Monitor, X } from "lucide-react";

export function App() {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const updateWidth = () => {
      setIsMobile(window.innerWidth < 768);
    }
    
    // Initial check
    updateWidth();

    window.addEventListener('resize', updateWidth);
    
    return () => {
      window.removeEventListener('resize', updateWidth);
    }
  }, [])

  return (
    <>
      {isMobile && (
        <div className="absolute bottom-8 left-6 right-6 z-[2000] animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-indigo-100 shadow-xl shadow-indigo-100/20 flex items-center gap-4 mx-auto max-w-sm">
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center shrink-0 border border-indigo-100">
              <Monitor className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-900 font-bold text-sm">Desktop Recommended</p>
              <p className="text-slate-500 text-xs truncate">pixels.earth works best on desktop ;)</p>
            </div>
          </div>
        </div>
      )}
      {/* <StartUsing> */}
      <SessionBalanceProvider>
        <Tour/>
        {/* Main pixel canvas */}
        <PixelCanvas />
      </SessionBalanceProvider>
      <Toaster
        theme="light"
        position="bottom-left"
        richColors
        expand
        // closeButton
        toastOptions={{
          style: { zIndex: 99999 },
          duration: 1100
        }}
      />
      {/* </StartUsing> */}
    </>
  );
}

export default App;
