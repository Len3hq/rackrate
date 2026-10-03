// Browser end-to-end test of the web app against a local anvil fork (driven by scripts/e2e-fork.sh).
// A minimal EIP-6963 test wallet forwards every request to anvil, which signs for its unlocked accounts.
//
//   node scripts/e2e-ui.mjs <weekly|demo> [outDir]
import { chromium } from "playwright-core";

const APP = process.env.APP_URL || "http://localhost:3102";
const RPC = process.env.FORK_RPC || "http://127.0.0.1:8549";
const ACCOUNT = process.env.TEST_ACCOUNT || "0x976EA74026E726554dB657fA54763abd0C3a0aa9"; // anvil account #6
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , phase = "weekly", OUT = "."] = process.argv;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 200)}`));

await page.addInitScript(({ RPC, ACCOUNT }) => {
  let id = 0;
  // Like a real wallet: no accounts until the user connects; the grant survives reloads.
  let authorized = sessionStorage.getItem("tw-auth") === "1";
  const rpc = async (method, params) => {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  };
  const provider = {
    request: async ({ method, params }) => {
      switch (method) {
        case "eth_requestAccounts":
          authorized = true;
          sessionStorage.setItem("tw-auth", "1");
          return [ACCOUNT];
        case "eth_accounts":
          return authorized ? [ACCOUNT] : [];
        case "eth_chainId":
          return "0x279f";
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
        case "wallet_watchAsset":
          return true;
        default:
          return rpc(method, params);
      }
    },
    on: () => {},
    removeListener: () => {},
  };
  const info = { uuid: "7d1c0c86-test-wallet", name: "Test Wallet", rdns: "dev.rackrate.testwallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><rect width='8' height='8' fill='%235532e0'/></svg>" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}, { RPC, ACCOUNT });

let failed = false;
const FORK_ARTIFACT = "Required data unavailable"; // anvil failing to load upstream state; not an app error
const step = async (name, fn) => {
  process.stdout.write(`- ${name} ... `);
  for (let attempt = 1; ; attempt++) {
    try {
      await fn();
      console.log(attempt > 1 ? `ok (retried after a fork artifact)` : "ok");
      return;
    } catch (e) {
      const toasts = await page.locator("[aria-live=polite]").last().innerText().catch(() => "");
      if (attempt < 3 && (e.message.includes(FORK_ARTIFACT) || toasts.includes(FORK_ARTIFACT))) {
        for (const b of await page.getByRole("button", { name: "Dismiss" }).all()) await b.click().catch(() => {});
        await page.waitForTimeout(3000);
        continue;
      }
      console.log("FAILED");
      await page.screenshot({ path: `${OUT}/e2e-failure.png` });
      console.log(e.message.split("\n")[0]);
      failed = true;
      throw e;
    }
  }
};
const button = (name) => page.getByRole("button", { name }).first();
/** Waits for the newest toast to confirm (failing fast with its message on an error), then clears toasts. */
const confirmed = async () => {
  const ok = page.getByText("Confirmed").first();
  const err = page.locator("[aria-live=polite] .text-rose").first();
  await Promise.race([ok.waitFor({ timeout: 90_000 }), err.waitFor({ timeout: 90_000 })]);
  if (!(await ok.isVisible().catch(() => false))) {
    const toast = await page.locator("[aria-live=polite]").last().innerText();
    throw new Error(`transaction failed: ${toast.replace(/\s+/g, " ")}`);
  }
  for (const b of await page.getByRole("button", { name: "Dismiss" }).all()) await b.click().catch(() => {});
};
const connect = async () => {
  await button("Connect wallet").click();
  await button("Test Wallet").click();
  await page.getByText(ACCOUNT.slice(0, 6)).first().waitFor({ timeout: 15_000 });
};

try {
  await step("open trade page and quote", async () => {
    await page.goto(`${APP}/trade`, { waitUntil: "load" });
    await page.getByText("Locked revenue").waitFor({ timeout: 120_000 });
  });
  await step("connect test wallet", connect);
  if (phase === "weekly") await step("claim faucet", async () => {
    await button("Get 10,000 test rrUSD").waitFor({ timeout: 30_000 });
    await button("Get 10,000 test rrUSD").click();
    await confirmed();
  });
  await step("approve rrUSD", async () => {
    await button("Approve rrUSD").waitFor({ timeout: 30_000 });
    await button("Approve rrUSD").click();
    await confirmed();
  });

  if (phase === "weekly") {
    await step("hedge 1 GPU for W41 and W42", async () => {
      await page.locator("fieldset").getByRole("button", { name: "W42", exact: true }).click();
      await button(/^Hedge 2 weeks$/).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await button(/^Hedge 2 weeks$/).click();
      await page.getByText(/You hold 2\.00 SHORT/).waitFor({ timeout: 90_000 });
    });
    await step("buy LONG with $500 in W42 only", async () => {
      await page.getByRole("tab", { name: "Lock compute cost" }).click();
      await page.locator("fieldset").getByRole("button", { name: "W41", exact: true }).click(); // deselect W41
      await button(/^Buy 1 week$/).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await button(/^Buy 1 week$/).click();
      await page.getByText(/You hold .* LONG across 1 week/).waitFor({ timeout: 90_000 });
    });
    await step("positions show in Portfolio", async () => {
      await page.getByRole("link", { name: "Portfolio" }).first().click();
      await page.getByText("2026-W41").waitFor({ timeout: 60_000 });
    });
    await page.screenshot({ path: `${OUT}/e2e-portfolio.png` });
    // W41: 1 SHORT, no LONG -> buy LONG back, then redeem. W42: 1 SHORT + ~1.04 LONG -> redeem, then sell the extra.
    for (const week of ["2026-W41", "2026-W42"]) {
      await step(`close ${week}`, async () => {
        const row = page.locator("div", { has: page.getByText(week, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Close" }) }).last();
        await row.getByRole("button", { name: "Close" }).click();
        const go = page.getByRole("button", { name: /^Close position/ });
        await go.waitFor({ timeout: 60_000 });
        await page.screenshot({ path: `${OUT}/e2e-close-${week}.png` });
        await go.click();
        await page.getByText(week, { exact: true }).waitFor({ state: "detached", timeout: 180_000 });
      });
    }
    await step("portfolio is empty after closing", async () => {
      await page.getByText("No positions yet").waitFor({ timeout: 60_000 });
    });
  } else {
    await step("hedge the demo week", async () => {
      await page.locator("fieldset").getByRole("button", { name: "W41", exact: true }).click(); // deselect the default weekly market
      await page.locator("fieldset").getByRole("button", { name: "Demo", exact: true }).click();
      await button(/^Hedge 1 week$/).waitFor({ timeout: 240_000 }); // the maker quotes once the demo feed has printed
      await page.waitForTimeout(800);
      await button(/^Hedge 1 week$/).click();
      await page.getByText(/You hold 1\.00 SHORT/).waitFor({ timeout: 90_000 });
    });
    await step("demo position shows in Portfolio", async () => {
      await page.getByRole("link", { name: "Portfolio" }).first().click();
      await page.getByText("H100 demo week").first().waitFor({ timeout: 60_000 });
    });
    await step("settle the demo week once it ends", async () => {
      await button("Settle").waitFor({ timeout: 600_000 });
      await page.waitForTimeout(20_000); // let the publishers finalize the last epoch
      for (let i = 0; i < 6; i++) {
        await button("Settle").click();
        await page.getByText(/Confirmed|reverted/).first().waitFor({ timeout: 90_000 });
        if (await page.getByText("Confirmed").count()) break;
        for (const b of await page.getByRole("button", { name: "Dismiss" }).all()) await b.click().catch(() => {});
        await page.waitForTimeout(15_000);
      }
      for (const b of await page.getByRole("button", { name: "Dismiss" }).all()) await b.click().catch(() => {});
      await page.getByText(/Settled at/).waitFor({ timeout: 60_000 });
    });
    await step("claim the demo payout", async () => {
      await button(/^Claim \$/).click();
      await confirmed();
      await page.getByText("No positions yet").waitFor({ timeout: 60_000 });
    });
  }
} catch (e) {
  if (!failed) {
    failed = true;
    console.log(`FAILED outside a step: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: `${OUT}/e2e-failure.png` });
  }
}
await page.screenshot({ path: `${OUT}/e2e-${phase}-end.png` });
console.log(errors.length ? `browser errors:\n${errors.join("\n")}` : "no browser errors");
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
