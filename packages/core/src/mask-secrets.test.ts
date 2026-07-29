import { describe, expect, it } from "vitest";
import { maskSecrets } from "./mask-secrets.js";

describe("maskSecrets", () => {
  it("redacts PEM private keys", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA1234567890abcdef",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const out = maskSecrets(`key follows\n${pem}\nok`);
    expect(out).toContain("[REDACTED_PRIVATE_KEY]");
    expect(out).not.toContain("MIIEowIBAAKCAQEA");
    expect(out).toContain("key follows");
    expect(out).toContain("ok");
  });

  it("redacts GitHub tokens", () => {
    const text = "token=ghp_abcdefghijklmnopqrstuvwxyz012345";
    expect(maskSecrets(text)).toBe("token=[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts fine-grained github_pat tokens", () => {
    const text = "github_pat_11AAAAAAAABCDEFGHIJKLMNOP";
    expect(maskSecrets(text)).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts sk- API keys", () => {
    const text = "DEEPSEEK_API_KEY=sk-abcdefghijklmnopqrstuvwxyz12";
    expect(maskSecrets(text)).toBe("DEEPSEEK_API_KEY=[REDACTED_API_KEY]");
  });

  it("redacts hyphenated sk- prefixes (live, proj, openrouter)", () => {
    const live = 'apiKey: "sk-live-abcdefghijklmnopqrstuvwxyz12"';
    expect(maskSecrets(live)).toBe('apiKey: "[REDACTED_API_KEY]"');
    expect(maskSecrets(live)).not.toContain("sk-live-");

    const proj = "key=sk-proj-abcdefghijklmnopqrstuvwxyz012345";
    expect(maskSecrets(proj)).toBe("key=[REDACTED_API_KEY]");

    const openrouter = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789";
    expect(maskSecrets(openrouter)).toBe("[REDACTED_API_KEY]");
  });

  it("redacts Bearer tokens", () => {
    const text = "Authorization: Bearer super-secret-token-value";
    expect(maskSecrets(text)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("redacts AWS access key ids", () => {
    const text = "key AKIAIOSFODNN7EXAMPLE rest";
    expect(maskSecrets(text)).toBe("key [REDACTED_AWS_KEY] rest");
  });

  it("leaves ordinary code and messages unchanged", () => {
    const text = "review failed: connection refused on port 5432";
    expect(maskSecrets(text)).toBe(text);
  });
});
