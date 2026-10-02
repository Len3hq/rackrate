import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { monadTestnet } from "wagmi/chains";

/** Public Monad testnet RPC by default; set NEXT_PUBLIC_MONAD_RPC_URL for a dedicated endpoint. */
const rpc = process.env.NEXT_PUBLIC_MONAD_RPC_URL || monadTestnet.rpcUrls.default.http[0];

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  // Browser wallets (Rabby, MetaMask, Phantom, Backpack...) are discovered through EIP-6963.
  multiInjectedProviderDiscovery: true,
  transports: { [monadTestnet.id]: http(rpc, { batch: { wait: 16 } }) },
  ssr: true,
});

export const chain = monadTestnet;
export const explorer = "https://testnet.monadvision.com";

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
