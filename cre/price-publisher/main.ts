/**
 * Rackrate price publisher — Chainlink CRE workflow (publisher A of RackOracle).
 *
 * On each cron trigger, for every configured hourly feed:
 *   1. read the feed state, chain time and this publisher's submissions / seed commitments (two Multicall3 reads),
 *   2. compute the index price with the same deterministic model the publisher bots use (secret master seed from
 *      CRE Secrets); from 2026-10-07 18:00 UTC the hourly H100 level follows real providers' published H100 prices, fetched
 *      through CRE's HTTP capability with the nodes agreeing on the median (bots/src/lib/reference.ts),
 *   3. build a batch of oracle actions (commit due seeds, submit the current epoch, reveal due seeds),
 *   4. sign it as a CRE report and deliver it to CreReceiver through the Chainlink forwarder.
 *
 * Every node computes the same actions from the same finalized chain state and secret, so the report reaches
 * consensus. The logic is shared with the confidential entry point (main-confidential.ts) through publisher.ts.
 */
import { CronCapability, EVMClient, Runner, type Runtime, getNetwork, handler } from "@chainlink/cre-sdk";
import { type Config, actionsForFeed, deliver, parseMaster } from "./publisher.ts";
import { referenceLevel } from "./reference-http.ts";

const onCronTrigger = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainName });
  if (!network) throw new Error(`Unknown chain ${cfg.chainName}`);
  const evm = new EVMClient(network.chainSelector.selector);

  const master = parseMaster(runtime.getSecret({ id: "PRICE_MASTER_SECRET" }).result().value);
  const level = (epochStart: number, memo: Map<string, number | null>) => referenceLevel(runtime, epochStart, memo);

  const actions = cfg.feeds.flatMap((f) => actionsForFeed(runtime, evm, f, master, level));
  if (actions.length === 0) {
    runtime.log("Nothing to publish this run");
    return "noop";
  }
  return deliver(runtime, evm, actions);
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
