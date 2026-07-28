import { describe, expect, it } from "vitest";
import { normalizePrivateKey } from "./auth.js";

describe("normalizePrivateKey", () => {
  it("turns escaped newlines into real newlines", () => {
    const raw = "-----BEGIN\\nKEY\\n-----END";
    const normalized = normalizePrivateKey(raw);
    expect(normalized).toBe("-----BEGIN\nKEY\n-----END");
  });

  it("leaves normal PEM newlines alone", () => {
    const raw = "-----BEGIN\nKEY\n-----END";
    expect(normalizePrivateKey(raw)).toBe(raw);
  });
});
