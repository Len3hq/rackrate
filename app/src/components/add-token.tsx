"use client";

import { PlusCircle } from "@phosphor-icons/react";
import type { Address } from "viem";
import { useWatchAsset } from "wagmi";
import { useToast } from "./toast";

/** Adds a token to the connected wallet's token list (EIP-747 wallet_watchAsset). All Rackrate tokens use 6 decimals. */
export function AddToken({ address, symbol, compact = false }: { address: Address; symbol: string; compact?: boolean }) {
  const { watchAssetAsync } = useWatchAsset();
  const toast = useToast();
  const add = async () => {
    try {
      await watchAssetAsync({ type: "ERC20", options: { address, symbol: symbol.slice(0, 11), decimals: 6 } });
    } catch {
      toast.show({ kind: "error", title: `Could not add ${symbol}`, body: "Your wallet declined or does not support adding tokens." });
    }
  };
  return (
    <button
      type="button"
      onClick={add}
      title={`Add ${symbol} to your wallet`}
      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs text-muted transition hover:bg-surface-2 hover:text-accent"
    >
      <PlusCircle size={13} />
      {compact ? symbol.replace(/^rr/, "") : `Add ${symbol} to wallet`}
    </button>
  );
}
