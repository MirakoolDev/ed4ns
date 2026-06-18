"use client";

import * as React from "react";
import {
  RainbowKitProvider,
  getDefaultConfig,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider, useConnect, useConnectors } from "wagmi";
import { base, celo } from "wagmi/chains";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import "@rainbow-me/rainbowkit/styles.css";

import { http } from "wagmi";

const sepoliaRpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_KEY 
  ? `https://eth-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}`
  : "https://ethereum-sepolia-rpc.publicnode.com";

const baseRpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_KEY 
  ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}`
  : "https://mainnet.base.org";

const config = getDefaultConfig({
  appName: "ed4ns",
  projectId: "43763f03b0d2bc4a5b481ad1240c5f43", 
  chains: [celo, base],
  transports: {
    [base.id]: http(baseRpcUrl, { batch: true }),
    [celo.id]: http("https://forno.celo.org", { batch: true }),
  },
  ssr: true, 
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 2,
    }
  }
});

function MiniPayAutoConnect() {
  const connectors = useConnectors();
  const { connect } = useConnect();
  const [hasAttempted, setHasAttempted] = React.useState(false);

  React.useEffect(() => {
    if (hasAttempted || connectors.length === 0) return;
    
    // Check if we're in the MiniPay browser
    const isMiniPay = typeof window !== 'undefined' && (window as any).ethereum?.isMiniPay;
    
    if (isMiniPay) {
      // Connect to the injected provider automatically
      connect({ connector: connectors[0] });
    }
    
    setHasAttempted(true);
  }, [connectors, connect, hasAttempted]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ borderRadius: 'none' })}>
          <MiniPayAutoConnect />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
