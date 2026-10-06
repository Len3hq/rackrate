import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi, Address } from "viem";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const CONTRACTS_DIR = resolve(ROOT, "contracts");

/** Load KEY=VALUE pairs from the repo's .env files without overriding variables already set. */
export function loadEnv(): void {
  for (const file of [resolve(ROOT, ".env"), resolve(CONTRACTS_DIR, ".env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key] !== undefined && process.env[key] !== "") continue;
      process.env[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
}

export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable ${name}`);
}

export interface Deployment {
  chainId: number;
  deployer: Address;
  rrUSD: Address;
  RackOracle: Address;
  SeriesFactory: Address;
  hourGenesis: number;
  demoGenesis: number;
}

export function loadDeployment(chainId = 10143): Deployment {
  const file = resolve(CONTRACTS_DIR, "deployments", `${chainId}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
}

/**
 * ABIs the app ships (app/src/lib/generated.ts, refreshed by `pnpm -C app sync-abis`). Used when Foundry's build
 * output is absent, e.g. in the bots' Docker image, so deployments don't need a Solidity toolchain.
 */
const GENERATED = resolve(ROOT, "app", "src", "lib", "generated.ts");
const shipped: Record<string, unknown> | null =
  existsSync(resolve(CONTRACTS_DIR, "out")) || !existsSync(GENERATED) ? null : await import(GENERATED);

/** ABI from Foundry build output (`forge build` in contracts/), else from the ABIs the app ships. */
export function loadAbi(contract: string): Abi {
  const file = resolve(CONTRACTS_DIR, "out", `${contract}.sol`, `${contract}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).abi as Abi;
  const abi = shipped?.[`${contract.charAt(0).toLowerCase()}${contract.slice(1)}Abi`];
  if (abi) return abi as Abi;
  throw new Error(`ABI for ${contract} not found: run \`forge build\` in contracts/`);
}

export function log(scope: string, msg: string): void {
  console.log(`${new Date().toISOString()} [${scope}] ${msg}`);
}
