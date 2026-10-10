/**
 * Shared logic of Rackrate's CRE price publisher (publisher A of RackOracle), used by both entry points:
 * main.ts (standard workflow, every step on the Workflow DON) and main-confidential.ts (Confidential Workflow, the
 * secret seed and price computation inside a TEE). Both plan the same oracle actions and deliver the same report.
 */
import {
  EVMClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  TxStatus,
  type Runtime,
  bytesToHex,
  encodeCallMsg,
  hexToBase64,
} from "@chainlink/cre-sdk";
import {
  type Address,
  type Hex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toBytes,
  zeroAddress,
} from "viem";
import {
  type Anchor,
  gpuOf,
  paramsFor,
  periodOf,
  periodSeed,
  publisherPrice,
  seedCommitment,
  seedLookahead,
} from "../../bots/src/lib/priceModel.ts";
import { ANCHOR_START, REFERENCE_FEEDS, anchorStartEpoch } from "../../bots/src/lib/reference.ts";

export type Config = {
  schedule: string;
  chainName: string;
  oracle: Address;
  receiver: Address;
  multicall3: Address;
  /** Hourly feed names, e.g. ["H100"]. Demo feeds are driven by the publisher bots. */
  feeds: string[];
  /** Gas budget: base overhead plus a per-action allowance (Monad bills the full gas limit). */
  gasBase: number;
  gasPerSubmit: number;
  gasPerCommit: number;
  gasPerReveal: number;
  /** Optional override of the real-price start (unix seconds), for tests. */
  anchorStart?: number;
};

export const ActionKind = { Submit: 0, CommitSeed: 1, RevealSeed: 2 } as const;

export type Action = { kind: number; feedId: Hex; a: bigint; b: bigint; data: Hex };

type FeedState = {
  exists: boolean;
  isDemo: boolean;
  epochLength: number;
  finalizeDelay: number;
  genesis: bigint;
  nextEpoch: bigint;
};

const oracleAbi = parseAbi([
  "function getFeed(bytes32 feedId) view returns ((bool exists, bool isDemo, uint8 minPublishers, uint8 publisherCount, uint8 consecutiveJumpRejects, uint16 maxJumpBps, uint32 epochLength, uint32 finalizeDelay, uint64 genesis, uint64 firstEpoch, uint64 nextEpoch, uint64 minPrice, uint64 maxPrice, uint64 lastPrice))",
  "function currentEpoch(bytes32 feedId) view returns (uint64)",
  "function hasSubmitted(bytes32 feedId, uint64 epoch, address publisher) view returns (bool)",
  "function seedCommits(bytes32 feedId, uint64 periodId, address publisher) view returns (bytes32 hash, uint64 revealAfter, bool revealed)",
]);

const multicallAbi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

type Call = { target: Address; callData: Hex };

/** One finalized-block eth_call to Multicall3 that runs several reads. */
function multicall(runtime: Runtime<Config>, evm: EVMClient, calls: Call[]): Hex[] {
  const data = encodeFunctionData({
    abi: multicallAbi,
    functionName: "aggregate3",
    args: [calls.map((c) => ({ target: c.target, allowFailure: false, callData: c.callData }))],
  });
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: runtime.config.multicall3, data }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  const results = decodeFunctionResult({
    abi: multicallAbi,
    functionName: "aggregate3",
    data: bytesToHex(reply.data),
  }) as readonly { success: boolean; returnData: Hex }[];
  return results.map((r) => r.returnData);
}

function oracleCall(cfg: Config, functionName: string, args: readonly unknown[]): Call {
  return {
    target: cfg.oracle,
    callData: encodeFunctionData({ abi: oracleAbi, functionName: functionName as never, args: args as never }),
  };
}

function decode<T>(functionName: string, data: Hex): T {
  return decodeFunctionResult({ abi: oracleAbi, functionName: functionName as never, data }) as T;
}

/** The hour's real reference level (USD per GPU-hour), or null when unavailable. Memoized per run by `memo`. */
export type LevelFn = (epochStart: number, memo: Map<string, number | null>) => number | null;

/**
 * Builds this publisher's actions for one feed. Chain reads go through `runtime` (Workflow DON); the real price level
 * comes from `level`, so the same planning runs on the DON (main.ts) or inside an enclave (main-confidential.ts).
 */
export function actionsForFeed(runtime: Runtime<Config>, evm: EVMClient, feedName: string, master: Hex, level: LevelFn): Action[] {
  const cfg = runtime.config;
  const me = cfg.receiver;
  const feedId = keccak256(toBytes(feedName));

  // Read 1: feed state, current epoch, chain time.
  const [feedRaw, curRaw, tsRaw] = multicall(runtime, evm, [
    oracleCall(cfg, "getFeed", [feedId]),
    oracleCall(cfg, "currentEpoch", [feedId]),
    {
      target: cfg.multicall3,
      callData: encodeFunctionData({ abi: multicallAbi, functionName: "getCurrentBlockTimestamp" }),
    },
  ]);
  const feed = decode<FeedState>("getFeed", feedRaw);
  if (!feed.exists) {
    runtime.log(`${feedName}: feed not found, skipping`);
    return [];
  }
  if (feed.isDemo) {
    runtime.log(`${feedName}: demo feeds are published by the bots, skipping`);
    return [];
  }
  const cur = decode<bigint>("currentEpoch", curRaw);
  const now = decodeFunctionResult({ abi: multicallAbi, functionName: "getCurrentBlockTimestamp", data: tsRaw }) as bigint;

  const params = paramsFor(feedName, feed.isDemo);
  const len = BigInt(feed.epochLength);
  const period = BigInt(params.periodEpochs);
  const lookahead = BigInt(seedLookahead(params));
  const p = periodOf(cur, params.periodEpochs);
  const seedFor = (q: bigint) => periodSeed(master, feedId, q);

  const commitRange: bigint[] = [];
  for (let q = p; q <= p + lookahead; q++) commitRange.push(q);
  const revealRange: bigint[] = [];
  for (let q = p - 1n; q >= 0n && q >= p - 2n * lookahead - 2n; q--) revealRange.push(q);
  // Backfill the previous epoch only while it can still count (before its finalize delay has passed).
  const epochs: bigint[] = [cur];
  if (cur > 0n && cur - 1n >= feed.nextEpoch && now < feed.genesis + cur * len + BigInt(feed.finalizeDelay)) {
    epochs.unshift(cur - 1n);
  }

  // Read 2: our submissions and seed commitments.
  const reads = multicall(runtime, evm, [
    ...epochs.map((e) => oracleCall(cfg, "hasSubmitted", [feedId, e, me])),
    ...commitRange.map((q) => oracleCall(cfg, "seedCommits", [feedId, q, me])),
    ...revealRange.map((q) => oracleCall(cfg, "seedCommits", [feedId, q, me])),
  ]);
  const submitted = reads.slice(0, epochs.length).map((d) => decode<boolean>("hasSubmitted", d));
  const commits = reads
    .slice(epochs.length)
    .map((d) => decode<readonly [Hex, bigint, boolean]>("seedCommits", d));
  const ahead = commits.slice(0, commitRange.length);
  const past = commits.slice(commitRange.length);

  const actions: Action[] = [];
  // 1. Commit every seed the current price depends on (commit before use).
  commitRange.forEach((q, i) => {
    if (ahead[i][0] !== ZERO_HASH) return;
    const revealAfter = feed.genesis + ((q + 1n) * period + 1n) * len;
    actions.push({ kind: ActionKind.CommitSeed, feedId, a: q, b: revealAfter, data: seedCommitment(seedFor(q)) });
  });
  // 2. Submit prices for open epochs (never for an epoch other publishers already finalized).
  const real = REFERENCE_FEEDS.has(gpuOf(feedName));
  const anchorFrom = anchorStartEpoch(feed.genesis, len, cfg.anchorStart ?? ANCHOR_START);
  const memo = new Map<string, number | null>();
  epochs.forEach((e, i) => {
    if (submitted[i] || e < feed.nextEpoch) return;
    let anchor: Anchor | undefined;
    if (real && e >= anchorFrom) {
      const epochStart = Number(feed.genesis + e * len);
      const lvl = level(epochStart, memo);
      if (lvl === null) {
        runtime.log(`${feedName}: epoch ${e}: reference prices unavailable, not submitting`);
        return;
      }
      anchor = { from: anchorFrom, level: lvl, epochStart };
    }
    const price = publisherPrice(seedFor, params, e, me, 0, anchor);
    actions.push({ kind: ActionKind.Submit, feedId, a: e, b: price, data: ZERO_HASH });
    runtime.log(`${feedName}: epoch ${e} price $${(Number(price) / 1e6).toFixed(4)}${anchor ? ` (real level $${anchor.level.toFixed(4)})` : ""}`);
  });
  // 3. Reveal seeds whose reveal time has passed.
  revealRange.forEach((q, i) => {
    const [hash, revealAfter, revealed] = past[i];
    if (hash === ZERO_HASH || revealed || now < revealAfter) return;
    actions.push({ kind: ActionKind.RevealSeed, feedId, a: q, b: 0n, data: seedFor(q) });
  });
  return actions;
}

/** Validates the master seed read from CRE Secrets. */
export function parseMaster(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("PRICE_MASTER_SECRET must be 32-byte hex");
  return value as Hex;
}

/**
 * Signs the actions as one CRE report and delivers it through the Chainlink forwarder to CreReceiver. `runtime` must
 * be a Workflow DON runtime (in a Confidential Workflow, `usingTheDons()`): report signing and chain writes always
 * run on the DON. Returns the transaction hash.
 */
export function deliver(runtime: Runtime<Config>, evm: EVMClient, actions: Action[]): string {
  const cfg = runtime.config;
  const payload = encodeAbiParameters(parseAbiParameters("(uint8 kind, bytes32 feedId, uint64 a, uint64 b, bytes32 data)[]"), [
    actions,
  ]);
  const count = (k: number) => actions.filter((x) => x.kind === k).length;
  const gasLimit =
    cfg.gasBase +
    count(ActionKind.Submit) * cfg.gasPerSubmit +
    count(ActionKind.CommitSeed) * cfg.gasPerCommit +
    count(ActionKind.RevealSeed) * cfg.gasPerReveal;

  const report = runtime
    .report({ encodedPayload: hexToBase64(payload), encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" })
    .result();
  const write = evm
    .writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: String(gasLimit) } })
    .result();

  const txHash = bytesToHex(write.txHash || new Uint8Array(32));
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Report delivery failed (status ${write.txStatus}): ${write.errorMessage ?? ""} tx ${txHash}`);
  }
  runtime.log(`Delivered ${actions.length} action(s) with gas limit ${gasLimit}: tx ${txHash}`);
  return txHash;
}
