/** Per-GPU parameters, all in micro-dollars per GPU-hour (6 decimals). Oracle bounds match script/Deploy.s.sol. */
export interface GpuSpec {
  oracleMin: bigint;
  oracleMax: bigint;
  /** Default series range: payouts are linear between floor and cap. */
  floor: bigint;
  cap: bigint;
}

export const GPUS: Record<string, GpuSpec> = {
  H100: { oracleMin: 500_000n, oracleMax: 20_000_000n, floor: 1_000_000n, cap: 5_000_000n },
  H200: { oracleMin: 750_000n, oracleMax: 25_000_000n, floor: 1_500_000n, cap: 6_500_000n },
  B200: { oracleMin: 1_000_000n, oracleMax: 40_000_000n, floor: 2_000_000n, cap: 9_000_000n },
};

export function gpuSpec(gpu: string): GpuSpec {
  const spec = GPUS[gpu];
  if (!spec) throw new Error(`Unknown GPU ${gpu} (expected one of ${Object.keys(GPUS).join(", ")})`);
  return spec;
}
