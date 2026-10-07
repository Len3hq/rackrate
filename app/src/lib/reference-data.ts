"use client";

import { useQuery } from "@tanstack/react-query";

/** One day of the real H100 rental index (see app/api/h100-reference). Prices are USD per GPU-hour. */
export interface ReferenceDay {
  date: string;
  index: number;
  low: number; // 25th percentile across providers
  high: number; // 75th percentile across providers
  providers: number;
}

export interface ReferenceSeries {
  source: { name: string; url: string; license: string; licenseUrl: string };
  days: ReferenceDay[];
  /** Each provider's median on-demand H100 SXM price on the latest day, cheapest first. */
  providers: { provider: string; price: number }[];
}

const PROVIDER_NAMES: Record<string, string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "Google Cloud",
  oracle: "Oracle Cloud",
  lambda: "Lambda",
  runpod: "RunPod",
  coreweave: "CoreWeave",
  nebius: "Nebius",
  crusoe: "Crusoe",
  datacrunch: "DataCrunch",
  hyperstack: "Hyperstack",
  jarvislabs: "JarvisLabs",
  massedcompute: "Massed Compute",
  scaleway: "Scaleway",
  tensordock: "TensorDock",
  thundercompute: "Thunder Compute",
  vultr: "Vultr",
  ovh: "OVHcloud",
  together: "Together AI",
  voltagepark: "Voltage Park",
  modal: "Modal",
};

/** Display name for a provider slug from the dataset. */
export const providerName = (slug: string) => PROVIDER_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);

/** The last 7 days of real H100 rental prices, served (and cached hourly) by the app's own API route. */
export function useReference() {
  return useQuery({
    queryKey: ["h100-reference"],
    queryFn: async (): Promise<ReferenceSeries> => {
      // The server caches the snapshots for an hour; the browser always asks it, so it never shows a stale shape.
      const res = await fetch("/api/h100-reference", { cache: "no-store" });
      if (!res.ok) throw new Error(`reference ${res.status}`);
      return res.json();
    },
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
  });
}
