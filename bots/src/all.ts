/**
 * Runs every hosted bot in one process: publishers B and C, the keeper and the market maker, each in its own
 * worker thread with the same arguments it would get as a standalone service. One Node runtime instead of four
 * keeps the memory bill down, and each worker is capped so V8 doesn't grow an idle heap it never gives back.
 *
 * A bot that crashes is restarted on its own (with backoff); the others keep running. On SIGTERM/SIGINT the
 * market maker gets a "stop" message and finishes its tick (so its state file is saved) before the process exits.
 *
 * Each bot reads its own variables (see README, "Hosting"), so the service needs all of them.
 *
 * Usage:
 *   node src/all.ts
 */
import { Worker } from "node:worker_threads";
import { log } from "./lib/config.ts";

interface Bot {
  name: string;
  script: string;
  argv: string[];
}

const BOTS: Bot[] = [
  { name: "publisher-b", script: "publisher.ts", argv: ["--key", "PUBLISHER_B_PRIVATE_KEY", "--feeds", "H100", "--interval", "60"] },
  {
    name: "publisher-c",
    script: "publisher.ts",
    argv: ["--key", "PUBLISHER_C_PRIVATE_KEY", "--feeds", "H100", "--interval", "60", "--skip-finalize", "--delay", "20"],
  },
  { name: "keeper", script: "keeper.ts", argv: ["--feeds", "H100", "--weeks", "4", "--interval", "300"] },
  { name: "mm", script: "mm.ts", argv: ["--interval", "60"] },
];

/** Per-worker heap caps. The bots sit well below these; they only stop V8 from growing heaps it doesn't need. */
const RESOURCE_LIMITS = { maxYoungGenerationSizeMb: 8, maxOldGenerationSizeMb: 128 };
const RESTART_MIN_MS = 10_000;
const RESTART_MAX_MS = 5 * 60_000;
/** A bot that ran this long before crashing is restarted with the shortest delay again. */
const HEALTHY_RUN_MS = 10 * 60_000;
const STOP_TIMEOUT_MS = 60_000;
const scope = "all";

const running = new Map<string, Worker>();
let stopping = false;

function start(bot: Bot, delayMs = RESTART_MIN_MS): void {
  const startedAt = Date.now();
  const worker = new Worker(new URL(bot.script, import.meta.url), { argv: bot.argv, resourceLimits: RESOURCE_LIMITS });
  running.set(bot.name, worker);
  worker.on("error", (err) => log(scope, `${bot.name}: crashed: ${err instanceof Error ? (err.stack ?? err.message) : err}`));
  worker.on("exit", (code) => {
    running.delete(bot.name);
    if (stopping) return;
    const next = Date.now() - startedAt >= HEALTHY_RUN_MS ? RESTART_MIN_MS : Math.min(delayMs * 2, RESTART_MAX_MS);
    log(scope, `${bot.name}: exited (code ${code}), restarting in ${Math.round(delayMs / 1000)} s`);
    setTimeout(() => start(bot, next), delayMs);
  });
}

async function shutdown(sig: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log(scope, `${sig}: stopping ${[...running.keys()].join(", ")}`);
  const exits = [...running.entries()].map(([name, worker]) => {
    const exited = new Promise<void>((r) => worker.once("exit", () => r()));
    // The market maker stops between ticks so its state file always matches its resting orders; the others hold no
    // state between ticks and stop at once, as a standalone bot would.
    if (name === "mm") worker.postMessage("stop");
    else void worker.terminate();
    return exited;
  });
  const timeout = new Promise<void>((r) => setTimeout(r, STOP_TIMEOUT_MS).unref());
  await Promise.race([Promise.all(exits), timeout]);
  log(scope, running.size ? `timed out waiting for ${[...running.keys()].join(", ")}` : "all bots stopped");
  process.exit(0);
}

for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void shutdown(sig));
log(scope, `starting ${BOTS.map((b) => b.name).join(", ")}`);
for (const bot of BOTS) start(bot);
