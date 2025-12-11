import { PixelCanvas } from "./components/pixel-canvas";
import { Toaster } from "sonner";
import "./index.css";
import StartUsing from "./components/start-using";
import { SessionBalanceProvider } from "./components/session-balance-provider";

export function App() {
  return (
    <StartUsing>
      <SessionBalanceProvider>
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
          duration:1000
        }}
      />
    </StartUsing>
  );
}

export default App;
