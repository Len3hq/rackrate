"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { type Abi, type Address, BaseError, ContractFunctionRevertedError } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { getPublicClient, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useToast } from "@/components/toast";
import { chain, explorer } from "./wagmi";

export interface TxRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

/** Human-readable reason for a failed call or rejected signature. */
export function txError(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      const known: Record<string, string> = {
        FaucetCooldown: "The faucet can be used once a day. Try again later.",
        AlreadySettled: "This week has already settled.",
        NotSettled: "This week has not settled yet.",
        ERC20InsufficientBalance: "Not enough balance.",
        ERC20InsufficientAllowance: "Approval is needed first.",
        InexactAmount: "Use an amount with at most 2 decimals.",
      };
      if (name && known[name]) return known[name];
      return name ? `Transaction reverted: ${name}` : revert.shortMessage;
    }
    if (/rejected|denied/i.test(err.shortMessage)) return "Request rejected in the wallet.";
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Send a contract call from the connected wallet. Gas is the estimate plus 15%, because Monad bills the gas
 * limit rather than gas used. Shows progress toasts and refreshes on-chain data once mined.
 */
export function useTx() {
  const config = useConfig();
  const { chainId, address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const send = useCallback(
    async (req: TxRequest, label: string): Promise<boolean> => {
      if (!address) {
        toast.show({ kind: "error", title: "Connect a wallet first" });
        return false;
      }
      setPending(label);
      const id = toast.show({ kind: "pending", title: label, body: "Confirm in your wallet" });
      try {
        if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
        const call = { ...req, args: req.args ?? [], account: address, chainId: chain.id } as never;
        const est = await getPublicClient(config, { chainId: chain.id }).estimateContractGas(call);
        const hash = await writeContract(config, { ...(call as object), gas: (est * 115n) / 100n } as never);
        toast.update(id, { kind: "pending", title: label, body: "Waiting for Monad to confirm", href: `${explorer}/tx/${hash}` });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: chain.id });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
        toast.update(id, { kind: "success", title: label, body: "Confirmed", href: `${explorer}/tx/${hash}` });
        await queryClient.invalidateQueries();
        return true;
      } catch (err) {
        toast.update(id, { kind: "error", title: label, body: txError(err) });
        return false;
      } finally {
        setPending(null);
      }
    },
    [address, chainId, config, queryClient, switchChainAsync, toast],
  );

  return { send, pending };
}
