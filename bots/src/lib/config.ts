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

/** ABI from Foundry build output. Run `forge build` in contracts/ first. */
export function loadAbi(contract: string): Abi {
  const file = resolve(CONTRACTS_DIR, "out", `${contract}.sol`, `${contract}.json`);
  if (!existsSync(file)) throw new Error(`ABI not found: ${file} (run \`forge build\` in contracts/)`);
  return JSON.parse(readFileSync(file, "utf8")).abi as Abi;
}

export function log(scope: string, msg: string): void {
  console.log(`${new Date().toISOString()} [${scope}] ${msg}`);
}
