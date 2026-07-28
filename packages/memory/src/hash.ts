import { createHash } from "node:crypto";

/**
 * Stable content hash for incremental re-embed decisions.
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
