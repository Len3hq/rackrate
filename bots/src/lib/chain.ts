import {
  type Abi,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { env } from "./config.ts";

export interface Ctx {
  pub: PublicClient;
  wallet: WalletClient;
  account: Account;
}

export function rpcUrl(): string {
  return env("BOT_RPC_URL", env("MONAD_RPC_URL_PRIVATE", env("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz")));
}

export function publicClient(): PublicClient {
  return createPublicClient({ chain: monadTestnet, transport: http(rpcUrl()) }) as PublicClient;
}

export function ctxFromKeyEnv(keyEnv: string): Ctx {
  const account = privateKeyToAccount(env(keyEnv) as Hex);
  const transport = http(rpcUrl());
  return {
    pub: createPublicClient({ chain: monadTestnet, transport }) as PublicClient,
    wallet: createWalletClient({ chain: monadTestnet, transport, account }),
    account,
  };
}

export interface Call {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  /** Extra gas on top of the estimate (e.g. a submit that may also trigger finalization). */
  extraGas?: bigint;
}

/**
 * Send a transaction with an explicit gas limit. Monad charges the full gas *limit*, so we estimate
 * and add a small buffer instead of relying on generous defaults.
 */
export async function send(ctx: Ctx, call: Call): Promise<Hex> {
  const req = {
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args ?? [],
    account: ctx.account,
  };
  const est = await ctx.pub.estimateContractGas(req);
  const gas = (est * 115n) / 100n + (call.extraGas ?? 0n);
  const hash = await ctx.wallet.writeContract({ ...req, chain: monadTestnet, gas });
  const receipt = await ctx.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${call.functionName} reverted: ${hash}`);
  return hash;
}

/** Custom error name of a contract revert (e.g. "EpochAlreadyFinalized"), if the error is one. */
export function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? revert.reason) : undefined;
}

export function errorMessage(err: unknown): string {
  const name = revertName(err);
  if (name) return `reverted: ${name}`;
  if (err instanceof BaseError) return err.shortMessage;
  return (err as Error).message.split("\n")[0];
}

export async function chainTime(pub: PublicClient): Promise<bigint> {
  return (await pub.getBlock({ blockTag: "latest" })).timestamp;
}
