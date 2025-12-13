import { PixelCanvas } from "./components/pixel-canvas";
import { Toaster } from "sonner";
import "./index.css";
import { SessionBalanceProvider } from "./components/session-balance-provider";
import Tour from "./components/tour";

export function App() {

  return (
    <>

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
