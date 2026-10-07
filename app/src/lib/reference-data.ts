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
}

/** The last 7 days of real H100 rental prices, served (and cached hourly) by the app's own API route. */
export function useReference() {
  return useQuery({
    queryKey: ["h100-reference"],
    queryFn: async (): Promise<ReferenceSeries> => {
      const res = await fetch("/api/h100-reference");
      if (!res.ok) throw new Error(`reference ${res.status}`);
      return res.json();
    },
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
  });
}
