/**
 * Redact common secret shapes from free-form text before logging or LLM send.
 * Heuristic only — not a substitute for never putting secrets into prompts.
 */
export function maskSecrets(text: string): string {
  let out = text;

  // PEM private keys (GitHub App, RSA, etc.)
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]",
  );

  // GitHub classic / fine-grained PATs and app tokens
  out = out.replace(
    /\b(ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{20,}\b/g,
    "[REDACTED_GITHUB_TOKEN]",
  );
  out = out.replace(
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    "[REDACTED_GITHUB_TOKEN]",
  );

  // OpenAI / DeepSeek / OpenRouter-style secret keys (sk-, sk-live-, sk-proj-, sk-or-v1-, …)
  out = out.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]");

  // Authorization bearer tokens in log lines
  out = out.replace(
    /\b(Bearer\s+)[A-Za-z0-9._\-+/=]{16,}/gi,
    "$1[REDACTED_TOKEN]",
  );

  // AWS access key ids
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");

  return out;
}
