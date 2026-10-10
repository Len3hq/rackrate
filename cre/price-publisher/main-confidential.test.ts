// Unit tests for the Confidential Workflow pieces: the enclave's real-price fetch and the capability restrictions.
// Run: bun test
import { expect } from "bun:test";
import type { TeeRuntime } from "@chainlink/cre-sdk";
import { HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { gzipSync } from "fflate";
import { anchorLevel, snapshotUrl } from "../../bots/src/lib/reference.ts";
import { buildRestrictions } from "./main-confidential.ts";
import type { Config } from "./publisher.ts";
import { teeReferenceLevel } from "./reference-http.ts";

const offers = (scale: number) => ({
  offers: [2.5, 3.0, 3.2, 3.49, 3.6, 4.0, 11.0].map((v, i) => ({ provider: `p${i}`, gpu: "h100-sxm", kind: "on-demand", usd_hr: v * scale })),
});
const gz = (o: unknown) => Buffer.from(gzipSync(Buffer.from(JSON.stringify(o)))).toString("base64");
/**
 * This SDK version doesn't export a test constructor for TeeRuntime. The enclave fetch only uses the runtime to make a
 * direct HTTP capability call, which the standard test runtime serves through the same capability mock.
 */
const teeRuntime = () => newTestRuntime() as unknown as TeeRuntime<unknown>;

test("the enclave fetches each day's snapshot once, directly, and interpolates through the day", () => {
  const http = HttpActionsMock.testInstance();
  const urls: string[] = [];
  http.sendRequest = (req) => {
    urls.push(req.url);
    return { statusCode: 200, body: gz(offers(req.url.endsWith("2026-10-11.json") ? 1.1 : 1)) };
  };
  const v = teeReferenceLevel(teeRuntime(), Date.UTC(2026, 9, 12, 6) / 1000, new Map());
  expect(v).toBeCloseTo(anchorLevel(3.49, 3.49 * 1.1, 0.25), 9);
  expect(urls).toEqual([snapshotUrl("2026-10-10"), snapshotUrl("2026-10-11")]);
});

test("the enclave falls back to the previous day, and returns null with no data", () => {
  const http = HttpActionsMock.testInstance();
  http.sendRequest = (req) =>
    req.url.endsWith("2026-10-11.json") ? { statusCode: 404, body: "" } : { statusCode: 200, body: gz(offers(1)) };
  expect(teeReferenceLevel(teeRuntime(), Date.UTC(2026, 9, 12, 6) / 1000, new Map())).toBeCloseTo(3.49, 9);

  http.sendRequest = () => ({ statusCode: 404, body: "" });
  expect(teeReferenceLevel(teeRuntime(), Date.UTC(2026, 9, 12) / 1000, new Map())).toBeNull();
});

test("restrictions allow only this workflow's capabilities and its one secret", () => {
  const cfg = { chainName: "monad-testnet", feeds: ["H100"] } as Config;
  const r = buildRestrictions(cfg);
  expect(r.capabilities.type).toBe("CAPABILITY_RESTRICTION_TYPE_CLOSED");
  expect(r.capabilities.restrictions).toHaveLength(4);
  expect(r.capabilities.maxTotalCalls).toBe(8);
  expect(r.secrets).toEqual({ maxSecrets: 1, restrictions: [{ exactSecret: { id: "PRICE_MASTER_SECRET", namespace: "main" } }] });
});
