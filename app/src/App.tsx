import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PixelCanvas } from "./components/pixel-canvas";
import "./index.css";
import StartUsing from "./components/start-using";

export function App() {
  return (
    <>
      {/* Wallet button overlay */}
      {/* <div className="absolute top-4 right-4 z-50">
        <WalletMultiButton />
      </div> */}
        {/*startup flow */}
        <StartUsing />
      
      {/* Main pixel canvas */}
      <PixelCanvas />
    </>
  );
}

export default App;
