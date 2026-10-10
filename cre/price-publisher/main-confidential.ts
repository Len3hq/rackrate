/**
 * Rackrate price publisher as a Chainlink Confidential Workflow (CRE private beta).
 *
 * Same job as main.ts (publisher A of RackOracle), but the handler runs inside a TEE enclave:
 *   - in the enclave: the master seed, released by the Vault DON only to an attested enclave, the real-price fetch
 *     (one direct HTTP request) and the price computation, including deriving each period's seed;
 *   - on the Workflow DON, through `usingTheDons()`: the oracle reads, report signing and the write to CreReceiver.
 * Node operators never see the master seed. Revealed per-period seeds are public by design (commit before use, reveal
 * after), so every print can still be audited.
 *
 *   cre workflow simulate price-publisher --target confidential-settings --non-interactive --trigger-index 0
 */
import {
  CronCapability,
  EVMClient,
  EVMRestrictor,
  HTTPClientRestrictor,
  Runner,
  type TeeRuntime,
  getNetwork,
  handlerInTee,
} from "@chainlink/cre-sdk";
import { type Config, actionsForFeed, deliver, parseMaster } from "./publisher.ts";
import { teeReferenceLevel } from "./reference-http.ts";

const MASTER_SECRET_ID = "PRICE_MASTER_SECRET";
const CONSENSUS_CAPABILITY_ID = "consensus@1.0.0-alpha";
/** Per run and feed: two Multicall3 reads, and at most two days' snapshots with one fallback each. */
const READS_PER_FEED = 2;
const FETCHES_PER_FEED = 4;

const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainName });
  if (!network) throw new Error(`Unknown chain ${cfg.chainName}`);
  const evm = new EVMClient(network.chainSelector.selector);

  // Inside the enclave: the secret and everything derived from it.
  const master = parseMaster(runtime.getSecret({ id: MASTER_SECRET_ID }).result().value);
  const level = (epochStart: number, memo: Map<string, number | null>) => teeReferenceLevel(runtime, epochStart, memo);

  // Chain reads, report signing and chain writes always run on the Workflow DON.
  const dons = runtime.usingTheDons();
  const actions = cfg.feeds.flatMap((f) => actionsForFeed(dons, evm, f, master, level));
  if (actions.length === 0) {
    runtime.log("Nothing to publish this run");
    return "noop";
  }
  return deliver(dons, evm, actions);
};

/** Allows only the capabilities and the one secret this workflow uses. */
export const buildRestrictions = (config: Config) => {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainName });
  if (!network) throw new Error(`Unknown chain ${config.chainName}`);
  const evm = new EVMRestrictor(BigInt(network.chainSelector.selector));
  const feeds = config.feeds.length;
  const restrictions = [
    new HTTPClientRestrictor().limitSendRequest(FETCHES_PER_FEED * feeds),
    evm.limitCallContract(READS_PER_FEED * feeds),
    evm.limitWriteReport(1),
    { method: { id: CONSENSUS_CAPABILITY_ID, method: "Report", maxCalls: 1 } },
  ];
  return {
    capabilities: {
      type: "CAPABILITY_RESTRICTION_TYPE_CLOSED" as const,
      maxTotalCalls: (FETCHES_PER_FEED + READS_PER_FEED) * feeds + 2,
      restrictions,
    },
    secrets: {
      maxSecrets: 1,
      restrictions: [{ exactSecret: { id: MASTER_SECRET_ID, namespace: "main" } }],
    },
  };
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [
    handlerInTee(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger,
      {}, // any registered TEE (today AWS Nitro, us-west-2)
      { preHook: (cfg: Config) => buildRestrictions(cfg) },
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
