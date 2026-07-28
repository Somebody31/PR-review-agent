import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook.js";

function sign(body: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return "sha256=" + digest;
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    const body = '{"action":"opened"}';
    const secret = "test-secret";
    const header = sign(body, secret);
    expect(verifyWebhookSignature(body, header, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const secret = "test-secret";
    const header = sign('{"action":"opened"}', secret);
    expect(verifyWebhookSignature('{"action":"closed"}', header, secret)).toBe(false);
  });

  it("rejects missing signature", () => {
    expect(verifyWebhookSignature("{}", undefined, "secret")).toBe(false);
  });
});
