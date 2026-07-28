import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify GitHub webhook HMAC-SHA256 signature (X-Hub-Signature-256).
 * Returns true only when the signature matches the raw body and secret.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signatureHeader, "utf8");

  // timingSafeEqual throws if lengths differ — treat as invalid
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
