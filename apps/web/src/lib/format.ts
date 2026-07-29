/**
 * Small display helpers for the dashboard (pure functions, no React).
 */

/** Short SHA for tables: first 7 chars. */
export function shortSha(sha: string | null | undefined): string {
  if (!sha) {
    return "—";
  }
  return sha.slice(0, 7);
}

/** Format confidence 0–1 as percent string, or em dash when missing. */
export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(0)}%`;
}

/** Format USD cost string or number for tables. */
export function formatUsd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return "—";
  }
  return `$${n.toFixed(4)}`;
}

/** ISO / Date-ish string → local short datetime. */
export function formatWhen(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value;
  }
  return d.toLocaleString();
}

/** owner/repo#pr for list rows. */
export function formatPrLabel(
  owner: string | null | undefined,
  repo: string | null | undefined,
  prNumber: number | null | undefined,
): string {
  if (!owner || !repo || prNumber === null || prNumber === undefined) {
    return "—";
  }
  return `${owner}/${repo}#${prNumber}`;
}
