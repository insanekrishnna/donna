/** 0x12ab...9f3e */
export function shortAddress(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

/** "0.05" -> "0.05 HBAR" */
export function hbar(value: string | null | undefined): string {
  return value == null ? "-" : `${value} HBAR`;
}

/** Sum of decimal HBAR strings, exact (via tinybars). */
export function sumHbar(values: string[]): string {
  let total = 0n;
  for (const v of values) {
    const [whole = "0", fraction = ""] = v.split(".");
    total += BigInt(whole) * 100_000_000n + BigInt((fraction + "00000000").slice(0, 8));
  }
  const whole = total / 100_000_000n;
  const fraction = (total % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}
