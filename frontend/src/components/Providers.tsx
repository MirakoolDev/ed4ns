"use client";

import * as React from "react";
import {
  RainbowKitProvider,
  getDefaultConfig,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { base } from "wagmi/chains";
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
  projectId: "ce61f970339dca4ac67edebd251bda73", 
  chains: [base],
  transports: {
    [base.id]: http(baseRpcUrl, { batch: true }),
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

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ borderRadius: 'none' })}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
