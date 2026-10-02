"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi";
import { ToastProvider } from "./toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 2 } } }),
  );
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {/* Every Motion animation collapses to instant when the OS asks for reduced motion. */}
        <MotionConfig reducedMotion="user">
          <ToastProvider>{children}</ToastProvider>
        </MotionConfig>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
