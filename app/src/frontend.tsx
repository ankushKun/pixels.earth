/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

// IMPORTANT: Import polyfills first (side-effect import)
// This ensures Buffer is available before any other modules load
import "./polyfills";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WalletProvider } from "./providers/wallet-provider";
import { SessionKeyProvider } from "./hooks/use-session-key";
import { PostHogProvider } from 'posthog-js/react'
import { App } from "./App";

const options = {
  api_host: "https://eu.i.posthog.com",
  defaults: '2025-11-30',
} as const

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
     <PostHogProvider apiKey={"phc_Y9UZlKVXQjlMqgUVDkcNjJTmKcZD7XUtZvhX2lAFFrK"} options={options}>
    <WalletProvider>
      <SessionKeyProvider>
        <App />
      </SessionKeyProvider>
      </WalletProvider>
      </PostHogProvider>
  </StrictMode>
);

if (import.meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  // The hot module reloading API is not available in production.
  createRoot(elem).render(app);
}
