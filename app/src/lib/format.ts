/** Token amounts in this app all use 6 decimals (rrUSD, LONG, SHORT). */
export const UNIT = 1_000_000n;

export const toNum = (raw: bigint, decimals = 6) => Number(raw) / 10 ** decimals;

export function usd(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** Parse a decimal string into 6-decimal raw units, or null if it is not a valid positive amount. */
export function parseUnits6(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 6) return null;
  const raw = BigInt(whole || "0") * UNIT + BigInt((frac + "000000").slice(0, 6));
  return raw > 0n ? raw : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 5" style UTC date. */
export function utcDay(ts: number): string {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function utcHour(ts: number): string {
  const d = new Date(ts * 1000);
  return `${utcDay(ts)}, ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;
}

/** "3d 4h", "5h 12m", "42m" until a timestamp. */
export function countdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds)}s`;
}

const hhmm = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/** "Oct 5 to Oct 12" for weekly windows, "Oct 3, 14:05 to 14:15 UTC" for short demo windows. */
export function windowLabel(start: number, end: number): string {
  if (end - start >= 86_400) return `${utcDay(start)} to ${utcDay(end)}`;
  return `${utcDay(start)}, ${hhmm(start)} to ${hhmm(end)} UTC`;
}
